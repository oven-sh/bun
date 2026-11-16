// A clock of promise jobs counts turns. A cell does two waits one after the other, each one of thirty kinds, every ordered pair, inside
// each of five kinds of function. It logs the turn at which it stands behind each wait and the turn at which its caller sees it settle.
import type { Cell } from "./cells";

const waits: Record<string, string> = {
  "0": `await 0;`,
  resolved: `await Promise.resolve(0);`,
  made: `await new Promise(done => done(0));`,
  thenable: `await { then(done) { done(0); } };`,
  "resolved thenable": `await Promise.resolve({ then(done) { done(0); } });`,
  "made of a promise": `await new Promise(done => done(Promise.resolve(0)));`,
  "async call": `await (async () => 0)();`,
  "async returns promise": `await (async () => Promise.resolve(0))();`,
  "async returns await": `await (async () => await 0)();`,
  "async returns thenable": `await (async () => ({ then(done) { done(0); } }))();`,
  "async throws": `try { await (async () => { throw 0; })(); } catch {}`,
  rejected: `try { await Promise.reject(0); } catch {}`,
  caught: `await Promise.reject(0).catch(() => 0);`,
  then: `await Promise.resolve(0).then(() => 0);`,
  "then then": `await Promise.resolve(0).then(() => 0).then(() => 0);`,
  "then promise": `await Promise.resolve(0).then(() => Promise.resolve(0));`,
  finally: `await Promise.resolve(0).finally(() => 0);`,
  all: `await Promise.all([0, Promise.resolve(0)]);`,
  "all of none": `await Promise.all([]);`,
  race: `await Promise.race([0]);`,
  settled: `await Promise.allSettled([Promise.reject(0)]);`,
  any: `await Promise.any([Promise.reject(0), 0]);`,
  job: `await new Promise(done => queueMicrotask(done));`,
  "for await list": `for await (const each of [0, Promise.resolve(0)]) log("e" + turn);`,
  "for await generator": `for await (const each of (async function* () { yield 0; yield 0; })()) log("e" + turn);`,
  "for await sync generator": `for await (const each of (function* () { yield 0; yield Promise.resolve(0); })()) log("e" + turn);`,
  "for await left": `for await (const each of (async function* () { try { yield 0; yield 0; } finally { await 0; } })()) break;`,
  "next of generator": `await (async function* () { yield Promise.resolve(0); })().next();`,
  "return of generator": `await (async function* () { yield 0; })().return(Promise.resolve(0));`,
  "yield star": `for await (const each of (async function* () { yield* (async function* () { yield 0; })(); })()) log("e" + turn);`,
};

const kinds: Record<string, (id: string, body: string) => string> = {
  function: (id, body) => `async function ${id}() { ${body} }`,
  arrow: (id, body) => `const ${id} = async () => { ${body} };`,
  method: (id, body) => `class C${id} { async run() { ${body} } }\nconst ${id} = () => new C${id}().run();`,
  generator: (id, body) => `async function* g${id}() { ${body} }\nconst ${id} = () => g${id}().next();`,
  "in try": (id, body) => `async function ${id}() { try { ${body} } finally { log("f" + turn); } }`,
};

export const helpers = `let turn = 0, running = false;
function clock() { if (running) { turn++; Promise.resolve().then(clock); } }
`;
export const call = `turn = 0; running = true;
  Promise.resolve().then(clock);
  await run().then(() => log("d" + turn), () => log("!" + turn));
  running = false;
  await new Promise(done => setTimeout(done, 0));`;

export function cells(): Cell[] {
  const all: Cell[] = [];
  for (const kind of Object.keys(kinds))
    for (const first of Object.keys(waits))
      for (const second of Object.keys(waits)) {
        const id = "w" + (all.length + 1);
        all.push({
          id,
          what: `${kind} | ${first} . ${second}`,
          text: kinds[kind](id, `log("a" + turn); ${waits[first]} log("b" + turn); ${waits[second]} log("c" + turn);`),
        });
      }
  return all;
}
