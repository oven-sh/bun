const drive = (generator, script, a) =>
  [...script].map(step => outcome(() => generator[{ n: "next", r: "return", t: "throw" }[step]](a), []));
const scripts = () => ["nnnnnn", "", "nnr", "t", "nntn", "nrn"].flatMap(script => [1, 0.5, "s", { a: 1 }].map(a => [script, a]));

for (const body of [
  "let s = 0; for (let i = 0; i < 4; i++) s += yield i; return s;", "for (let i = 0; i < 6; i++) if (i & 1) yield i + a;",
  "try { yield 1; } catch (e) { yield e; } finally { yield 2; }", "yield* [1, a]; yield* (function* () { yield a; })();",
  "let x = 1, y = 's'; for (;;) { yield x; [x, y] = [y, x]; }",
  "let x = a, y = 7; yield; try { const t = x; x = y; y = t; null.x; } catch { yield [x, y]; }",
  "for (const x of new Set([1, 2])) for (const k in { p: 1 }) yield x + k;", "yield typeof this; yield arguments.length;",
  "for (let i = 0; i < 6; i++) switch (i) { case 0: yield 0; case 1: yield 1; case 2: yield 2; case 3: yield 3; default: yield 4; }",
])
  checkInTurn(`(() => { function* g(a) { ${body} } return (script, a) => drive(g(a), script, a); })()`, scripts, 8);

for (const elements of ["[, yield]", "[, ...[yield]]"])
  for (const use of ["String(list[0])", "String(...list)", "String((([first]) => first)(list))"]) {
    const holey = (0, eval)(`(function* () { const list = ${elements}; return ${use}; })`);
    for (let turn = 0; turn < 200; turn++) {
      const generator = holey();
      generator.next();
      if (generator.next(turn).value !== "undefined") throw new Error(elements + use);
    }
  }

function* remade() {}
for (let turn = 0; turn < 100; turn++) remade();
remade.prototype = { mark: 5 };
if (remade().mark !== 5) throw new Error("the old prototype");

// What counts is the order in which things happen.
const awaited = () => [
  1, undefined, { a: 1 }, Promise.resolve(1), Promise.reject(7), new Promise(resolve => Promise.resolve().then(() => resolve(4))),
  (class extends Promise {}).resolve(3), { then: resolve => resolve(6) }, { get then() { throw 8; } },
];
async function observe(f, a) {
  const events = [];
  f(a, events).then(value => events.push("ok" + show(value)), error => events.push("no" + show(error)));
  for (let tick = 0; tick < 12; tick++) events.push(await tick);
  return events.join();
}
async function checkAsync(body) {
  const copy = () => (0, eval)(`(async function (a, events) { ${body} })`);
  const hot = copy();
  for (let round = 0; round < 25; round++) {
    for (let index = 0; index < awaited().length; index++) {
      const actual = await observe(hot, awaited()[index]);
      if (round % 8) continue;
      const expected = await observe(copy(), awaited()[index]);
      if (actual !== expected) throw new Error(`${body}\n${index}: ${actual} instead of ${expected}`);
    }
  }
}
expectFulfilled(Promise.all([
  "return a;", "return { a };", "await { v: 1 }; return await a;", "let s = 0; for (let i = 0; i < 3; i++) if (i & 1) s += await a; return s;",
  "try { return await a; } catch (e) { return 'c' + e; } finally { events.push('f'); }",
  "let x = 1, y = 2; await a; [x, y] = [y, x]; await a; return [x, y];",
  "for await (const x of (async function* () { yield a; yield 2; })()) events.push(show(x));",
  "for await (const x of [a]) events.push(show(x));", "return new Promise(resolve => resolve(a));",
].map(checkAsync)));
check(a => { function* g(x, f = () => x, ...rest) { yield [f(), rest]; } return [...g(a, undefined, 2)]; }, () => [[1], ["s"]]);
check(a => { function* g(x) { x = { a }; const y = { x }; yield yield* [0, 1]; return y; } const it = g(); return [it.next(), it.next(), it.next(), it.next()]; }, () => [[1], ["s"]]);
