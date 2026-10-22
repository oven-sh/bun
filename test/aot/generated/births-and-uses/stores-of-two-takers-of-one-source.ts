// Two takers, each under an AsyncLocalStorage store of its own, take values from ONE shared source. After every step each says under which store it goes on. An await goes on under the
// store it was reached under, so whoever steps by `await source.next()` keeps its own; what a loop and `yield*` do is plain Bun's to say, and the compiled program says the same.
// A program is a source, the two takers, what tracks the store (run, enterWith, an AsyncResource, a snapshot, bind), the second taker's store, and whether the takers await first.
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const sources: Record<string, string> = {
    generator: `async function* reads() { for (let i = 0; i < 6; i++) { await null; yield "v" + i + " made under " + store(); } }\nconst shared = reads();`,
    generatorWithoutAwait: `async function* reads() { for (let i = 0; i < 6; i++) yield "v" + i + " made under " + store(); }\nconst shared = reads();`,
    generatorOverGenerator: `async function* inner() { for (let i = 0; i < 6; i++) { await null; yield "v" + i + " made under " + store(); } }\nasync function* reads() { yield* inner(); }\nconst shared = reads();`,
    generatorThatWaits: `async function* reads() { for (let i = 0; i < 6; i++) { await new Promise(f => setTimeout(f, 1)); yield "v" + i + " made under " + store(); } }\nconst shared = reads();`,
    queue: `const waiting = [], ready = []; let made = 0, over = false;
  function feed() { const value = "v" + made++ + " made under " + store(); const w = waiting.shift(); if (w) w({ done: false, value }); else ready.push(value); if (made === 6) { over = true; for (const x of waiting.splice(0)) x({ done: true, value: undefined }); } else queueMicrotask(feed); }
  const shared = { [Symbol.asyncIterator]() { return this; }, next() { if (ready.length) return Promise.resolve({ done: false, value: ready.shift() }); if (over) return Promise.resolve({ done: true, value: undefined }); return new Promise(f => waiting.push(f)); } };
  storage.run("feeder", () => queueMicrotask(feed));`,
  };
  const takers: Record<string, string> = {
    loop: `async function NAME(name, source) { FIRST for await (const value of source) lines.push(name + " under " + store() + ": " + value); return name + " ends under " + store(); }`,
    byHand: `async function NAME(name, source) { FIRST for (let step = await source.next(); !step.done; step = await source.next()) lines.push(name + " under " + store() + ": " + step.value); return name + " ends under " + store(); }`,
    byHandHeld: `async function NAME(name, source) { FIRST for (;;) { const promise = source.next(); const step = await promise; if (step.done) break; lines.push(name + " under " + store() + ": " + step.value); } return name + " ends under " + store(); }`,
    byThen: `function NAME(name, source) { return new Promise(finish => { const go = () => source.next().then(step => { if (step.done) return finish(name + " ends under " + store()); lines.push(name + " under " + store() + ": " + step.value); go(); }); go(); }); }`,
    delegated: `async function* throughNAME(source) { yield* source; lines.push("delegator of NAME ends under " + store()); }\nasync function NAME(name, source) { FIRST for await (const value of throughNAME(source)) lines.push(name + " under " + store() + ": " + value); return name + " ends under " + store(); }`,
    generatorByHand: `async function* stepsNAME(name, source) { for (let step = await source.next(); !step.done; step = await source.next()) yield name + " inside under " + store() + ": " + step.value; }\nasync function NAME(name, source) { FIRST for await (const value of stepsNAME(name, source)) lines.push(name + " under " + store() + ": " + value); return name + " ends under " + store(); }`,
  };
  const trackers: Record<string, (name: string, fn: string) => string> = { // how `fn` is run under the store `name`
    run: (name, fn) => `storage.run(${name}, () => ${fn})`,
    enterWith: (name, fn) => `(async () => { storage.enterWith(${name}); return ${fn}; })()`,
    resource: (name, fn) => `storage.run(${name}, () => new AsyncResource("taker")).runInAsyncScope(() => ${fn})`,
    snapshot: (name, fn) => `storage.run(${name}, () => AsyncLocalStorage.snapshot())(() => ${fn})`,
    bound: (name, fn) => `storage.run(${name}, () => AsyncLocalStorage.bind(() => ${fn}))()`,
  };
  const seconds: Record<string, string | null> = { other: '"two"', same: '"one"', none: null };
  for (const [s, source] of Object.entries(sources)) for (const [a, takerA] of Object.entries(takers)) for (const [b, takerB] of Object.entries(takers)) for (const [t, tracker] of Object.entries(trackers)) for (const [w, second] of Object.entries(seconds)) for (const first of ["atOnce", "awaitsFirst"]) {
    if (first === "awaitsFirst" && a === "byThen" && b === "byThen") continue;
    const F = first === "awaitsFirst" ? "await null;" : "";
    made.push({ name: `${s}-${a}-${b}-${t}-${w}-${first}`, file: "program.mjs", text: `import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
  const storage = new AsyncLocalStorage(), lines = [];
  const store = () => String(storage.getStore());
  ${source}
  ${takerA.replaceAll("NAME", "takeA").replace("FIRST", F)}
  ${takerB.replaceAll("NAME", "takeB").replace("FIRST", F)}
  lines.push(...(await Promise.all([${tracker('"one"', 'takeA("a", shared)')}, ${second === null ? 'takeB("b", shared)' : tracker(second, 'takeB("b", shared)')}])));
  lines.push("the module goes on under " + store());
  console.log(lines.join("\\n"));
  ` });
  }
  return made;
}
