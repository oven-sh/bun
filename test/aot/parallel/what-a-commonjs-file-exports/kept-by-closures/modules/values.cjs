"use strict";
const getTable = (() => { let kept; return () => kept || (kept = make(3)); })();
function make(n) { return hidden({ add(a, b) { return a + b + n; }, size: n }); }
function hidden(value) { return JSON.parse("[1]")[0] === 1 ? value : null; }
function lazy(load) { let value; return () => value ?? (value = load()); }
class Point { constructor(x) { this.x = x; } twice() { return this.x * 2; } }
const getPoint = lazy(() => hidden(new Point(4)));
function counter() { let last; let calls = 0; return function (n) { if (!last) { last = hidden({ n: 0 }); calls++; } last.n += n; return last.n + calls; }; }
const count = counter(), other = counter();
let sum = 0;
function run(n) { let s = 0; for (let i = 0; i < n; i++) s += getTable().add(i, 1) + getPoint().twice() + count(1) + getTable().size; return s; }
for (let i = 0; i < 3; i++) console.log(run(5), run(200), other(i));
// Several values through one variable, and what throws in between.
function changing() { let held; let step = 0; return () => { const before = held; held = step++ % 3 === 0 ? hidden({ step }) : step % 3 === 2 ? hidden("word") : hidden(undefined); return [before, held]; }; }
const change = changing();
for (let i = 0; i < 6; i++) console.log(JSON.stringify(change()));
function failing() { let held = 1; return (f) => { try { return held = f(); } catch (e) { return [held, e.message]; } finally { held = held || "none"; } }; }
const fail = failing();
console.log(JSON.stringify([fail(() => 2), fail(() => { throw new Error("no"); }), fail(() => null), fail(() => ({ deep: 1 })), fail(() => { throw new Error("again"); })]));
function* steps() { let held; for (let i = 0; i < 3; i++) { held = hidden({ i }); yield held.i; held.i = 9; yield held.i; } }
console.log([...steps()].join());
(async () => { let held; const get = async () => held ||= hidden({ late: 1 }); console.log((await get()).late, (await get()) === held, held.late); })();
