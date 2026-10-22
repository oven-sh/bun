// Functions made from text at run time whose variables are captured, so that each call, each block and each turn of a loop makes an environment: with none, one, two, many variables,
// let and const that are read too early, async functions and generators, `this` in strict and sloppy code. Each case runs many times: the first environments of a scope are made the long way.
const lines = [];
async function show(name, run, turns = 8) {
  const seen = [];
  for (let turn = 0; turn < turns; turn++) {
    try {
      seen.push(JSON.stringify(await run(turn)) ?? "undefined");
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  const distinct = new Set(seen.map(text => text.replace(/\d+/g, "#")));
  lines.push(name + ": " + distinct.size + " form(s): " + seen[0] + " | " + seen[1] + " | " + seen[2] + " | " + seen[turns - 1]);
}
const make = (parameters, text) => new Function(...parameters, text);

await show("one captured parameter", make(["a"], "return (() => a)();"));
await show("two captured variables", make(["a"], "let b = a + 1; return (() => [a, b])();"));
await show("three, four, five", make(["a"], "let b = a + 1, c = a + 2; const d = a + 3; var e = a + 4; return [(() => [a, b, c])(), (() => [a, b, c, d])(), (() => [a, b, c, d, e])()];"));
await show("forty captured variables", (() => {
  const names = Array.from({ length: 40 }, (_, i) => "v" + i);
  return make(["a"], names.map((n, i) => `let ${n} = a + ${i};`).join("") + "return (() => " + names.join(" + ") + ")();");
})());
await show("two thousand captured variables", (() => {
  const names = Array.from({ length: 2000 }, (_, i) => "v" + i);
  return make(["a"], names.map((n, i) => `let ${n} = a + ${i};`).join("") + "return (() => v0 + v1 + v999 + v1999)();");
})());
await show("an environment for each turn of a loop", make(["a"], "const list = []; for (let i = 0; i < 4; i++) { let twice = i * 2; list.push(() => [a, i, twice]); } return list.map(f => f());"));
await show("each closure keeps its own", make(["a"], "const list = []; for (let i = 0; i < 3; i++) list.push([() => i, () => { i += a; }]); list[1][1](); return list.map(pair => pair[0]());"));
await show("a block with let read too early", make(["a"], "{ const early = () => late; try { return early(); } catch (error) { return [error.constructor.name, a]; } let late = 1; }"));
await show("var is undefined, let is not there yet", make(["a"], "const seen = [(() => typeof early)()]; try { (() => late)(); } catch (error) { seen.push(error.constructor.name); } var early = a; let late = a; seen.push((() => [early, late])()); return seen;"));
await show("nested blocks", make(["a"], "let r = []; { let b = a; { let c = b + 1; { let d = c + 1; r.push(() => [a, b, c, d]); } } } return r[0]();"));
await show("switch and catch", make(["a"], "switch (a & 1) { case 0: { let x = 'even'; return (() => x)(); } default: try { throw a; } catch (caught) { return (() => caught)(); } }"));
await show("an async function", make(["a"], "return (async function (c) { try { const r = await c; return [r, a]; } catch (error) { return 'caught'; } })(a + 1);"));
await show("an async arrow that captures", make(["a"], "const add = async b => { const c = await b; return (() => a + c)(); }; return add(10);"));
await show("an async function that throws behind an await", make(["a"], "return (async function () { await 0; let late = (() => late)(); return late; })().catch(error => [error.constructor.name, a]);"));
await show("a generator", make(["a"], "function* g(n) { for (let i = 0; i < n; i++) { const f = () => i + a; yield f(); } } return [...g(3)];"));
await show("an async generator", make(["a"], "return (async () => { const all = []; for await (const v of (async function* () { let i = a; yield (() => i)(); i++; yield (() => i)(); })()) all.push(v); return all; })();"));
await show("this in strict code", make(["a"], "'use strict'; function f() { return this; } return [f() === undefined, f.call(a), typeof f.call('s'), f.call(null), f.call(true), typeof f.call({})];"));
await show("this in sloppy code", make(["a"], "function f() { return this; } return [f() === globalThis, typeof f.call(a), typeof f.call('s'), f.call(null) === globalThis, typeof f.call(true), typeof f.call({})];"));
await show("this in a strict async function", make(["a"], "'use strict'; return (async function () { return [this === undefined, a]; })();"));
await show("environments that are kept while many more are made", (() => {
  const kept = [];
  const one = make(["a"], "let b = a * 2, c = 'text' + a; return () => [a, b, c];");
  return turn => { for (let i = 0; i < 2000; i++) { const f = one(turn * 2000 + i); if (i % 500 === 0) kept.push(f); } return kept.slice(-3).map(f => f()); };
})());
console.log(lines.join("\n"));
