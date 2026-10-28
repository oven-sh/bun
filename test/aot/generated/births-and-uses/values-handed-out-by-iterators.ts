// Who hands out the values, what a value is, and who takes them. `for await` awaits what next() answers and never the value in it; the wrapper round a sync iterator and an async
// generator's `yield` do await the value. A rule of the compiler that mixes the two takes a promise for something that has been awaited: `await v` is dropped and `typeof v` is folded.
// Each program has one source, one kind of value and one taker, so that nothing but that pair decides what the compiler believes.
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const values: Record<string, string> = {
    integer: "7 + i", fraction: "1.5 + i", text: '"t" + i', record: "{ a: i }", list: "[i]", nothing: "undefined", none: "null", truth: "i === 0", big: "BigInt(i)",
    callable: "() => i", instance: "new Thing(i)", promise: "Promise.resolve(7 + i)", promiseOfRecord: "Promise.resolve({ a: i })", promiseOfPromiseLike: "Promise.resolve({ then(f) { f(i); } })",
    asyncResult: "later(i)", thenable: "{ then(f) { f(7 + i); } }", heir: "Heir.resolve(7 + i)", pending: "new Promise(() => {})", settledLater: "new Promise(f => setTimeout(f, 1, i))", mixed: "i === 0 ? 7 : Promise.resolve(8)",
  };
  const result = () => `i < 2 ? { done: false, value: make(i++) } : { done: true, value: undefined }`;
  const sources: Record<string, { async: boolean; awaits?: boolean; text: string }> = { // async: the source has Symbol.asyncIterator
    ownPlainNext: { async: true, text: `const it = { [Symbol.asyncIterator]() { let i = 0; return { next() { return ${result()}; } }; } };` },
    ownAsyncNext: { async: true, text: `const it = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return ${result()}; } }; } };` },
    ownPromiseNext: { async: true, text: `const it = { [Symbol.asyncIterator]() { let i = 0; return { next() { return Promise.resolve(${result()}); } }; } };` },
    ownArrowNext: { async: true, text: `const it = { [Symbol.asyncIterator]: () => { let i = 0; return { next: async () => (${result()}) }; } };` },
    ownClass: { async: true, text: `class Source { i = 0; [Symbol.asyncIterator]() { return this; } async next() { let i = this.i; const r = ${result()}; this.i = i; return r; } }\nconst it = new Source();` },
    ownWithReturn: { async: true, text: `const it = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return ${result()}; }, async return(v) { said.push("return"); return { done: true, value: v }; } }; } };` },
    asyncGenerator: { async: true, awaits: true, text: `async function* source() { for (let i = 0; i < 2; i++) yield make(i); }\nconst it = source();` },
    asyncGeneratorOverOwn: { async: true, text: `const inner = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return ${result()}; } }; } };\nasync function* source() { yield* inner; }\nconst it = source();` },
    syncOwn: { async: false, text: `const it = { [Symbol.iterator]() { let i = 0; return { next() { return ${result()}; } }; } };` },
    syncGenerator: { async: false, text: `function* source() { for (let i = 0; i < 2; i++) yield make(i); }\nconst it = source();` },
    array: { async: false, text: `const it = [make(0), make(1)];` },
    set: { async: false, text: `const it = new Set([make(0), make(1)]);` },
    mapValues: { async: false, text: `const it = new Map([[0, make(0)], [1, make(1)]]).values();` },
  };
  const takers: Record<string, { needs: string; awaits?: boolean; text: string; extra?: string }> = { // needs: "async" | "sync" | "any"; awaitsValues(source): does the pair await the value (then a pending promise never ends)
    forAwait: { needs: "any", text: `for await (const v of it) got.push(v);` },
    forAwaitBreak: { needs: "any", text: `for await (const v of it) { got.push(v); break; }` },
    forAwaitOuter: { needs: "any", text: `let v; for await (v of it) got.push(v); got.push(v);` },
    forAwaitPattern: { needs: "any", text: `for await (const [v] of wrap(it)) got.push(v);`, extra: `async function* wrap(s) { for await (const x of s) yield [x]; }` },
    forAwaitUsed: { needs: "any", text: `for await (const v of it) got.push(typeof v === "object" && v !== null && typeof v.then === "function" ? "thenable" : "plain", v);` },
    forAwaitThenAwait: { needs: "any", awaits: true, text: `for await (const v of it) got.push(await v);` },
    byHand: { needs: "async", text: `const walker = it[Symbol.asyncIterator](); for (;;) { const r = await walker.next(); if (r.done) break; got.push(r.value); }` },
    fromAsync: { needs: "any", text: `got.push(...(await Array.fromAsync(it)));` },
    delegated: { needs: "any", text: `async function* through() { yield* it; }\n  for await (const v of through()) got.push(v);` },
    forOf: { needs: "sync", text: `for (const v of it) got.push(v);` },
    spread: { needs: "sync", text: `got.push(...it);` },
    all: { needs: "sync", awaits: true, text: `got.push(...(await Promise.all(it)));` },
    allSettled: { needs: "sync", awaits: true, text: `got.push(...(await Promise.allSettled(it)).map(r => r.value));` },
    destructured: { needs: "sync", text: `const [first, second] = it; got.push(first, second);` },
  };
  const head = `class Thing { constructor(n) { this.n = n; } }
  class Heir extends Promise {}
  async function later(n) { return 7 + n; }
  const said = [], got = [];
  function show(v) { return typeof v + ":" + (v instanceof Promise) + ":" + (v instanceof Heir) + ":" + (v === null ? "null" : typeof v === "function" ? "f" + v() : typeof v === "bigint" ? v + "n" : typeof v === "object" ? (Array.isArray(v) ? "A" : "") + Object.keys(v).join("") + JSON.stringify(v) : String(v)); }
  const watch = setTimeout(() => { console.log("still waiting", got.map(show).join(" | ")); process.exit(0); }, 6000);
  `;
  for (const [s, source] of Object.entries(sources)) for (const [v, value] of Object.entries(values)) for (const [t, taker] of Object.entries(takers)) {
    if (taker.needs === "async" && !source.async || taker.needs === "sync" && source.async) continue;
    for (const place of ["top", "inside"]) {
      const inside = head + `function make(i) { return ${value}; }\n${taker.extra ?? ""}\n${source.text}\nasync function take(it) {\n  ${taker.text}\n}\ntry { await take(it); } catch (e) { console.log("threw", e.name); }\n`;
      const top = head + `function make(i) { return ${value}; }\n${taker.extra ?? ""}\n${source.text}\ntry {\n${taker.text}\n} catch (e) { console.log("threw", e.name); }\n`;
      made.push({ name: `${s}-${v}-${t}-${place}`, file: "program.mjs", text: (place === "top" ? top : inside) + `clearTimeout(watch);\nconsole.log(got.length, got.map(show).join(" | "), said.join());\nconst settled = []; for (const x of got) if (x instanceof Promise) settled.push(await Promise.race([x, new Promise(f => setTimeout(f, 30, "pending"))]));\nconsole.log(settled.map(show).join(" | "));\n` });
    }
  }
  return made;
}
