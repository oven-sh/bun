// A replaced `console.log` keeps the objects it is passed, so those objects must really be allocated and stay the same objects.
/// <reference path="./console_is_replaceable_decl.d.ts" />
const out = { print: console.log };
const kept: unknown[] = [];
console.log = (...values: unknown[]) => { for (const value of values) kept.push(value); };

function make(i: number) { const o = { n: i }; console.log(o); return o.n; }
let sum = 0;
for (let i = 0; i < 3; i++) sum += make(i);
(kept[1] as { n: number }).n = 40;
out.print("objects that were handed over: " + sum + " " + kept.map(o => (o as { n: number }).n).join());

function changedBehind() { const o = { n: 7 }; console.log(o); o.n = 8; return kept[kept.length - 1] === o && (kept[kept.length - 1] as { n: number }).n === 8; }
out.print("the object that was kept is the object: " + changedBehind());

function changedByTheOther() { const o = { n: 1 }; console.log(o); (kept[kept.length - 1] as { n: number }).n = 9; return o.n; }
out.print("a store through what was kept is seen: " + changedByTheOther());

function counter() { let c = 0; console.log(() => c, () => { c += 10; }); c = 5; (kept[kept.length - 1] as () => void)(); return c; }
out.print("closures that were kept share the variable: " + counter() + " " + (kept[kept.length - 2] as () => number)());

class Point { constructor(public x: number, public y: number) { } }
function point() { const p = new Point(1, 2); console.log(p); p.x = 3; return (kept[kept.length - 1] as Point).x + " " + (kept[kept.length - 1] instanceof Point); }
out.print("an instance of a class: " + point());

function list() { const a = [1, 2, 3]; console.log(a); a.push(4); return (kept[kept.length - 1] as number[]).join(); }
out.print("an array: " + list());

class Handler { run: () => string = () => "the function it was made with"; }
function otherFunction() {
  const handler = new Handler();
  const before = console.log;
  console.log = (...values: unknown[]) => { (values[0] as { run: () => string }).run = () => "the function that was stored by what console.log is now"; };
  console.log(handler);
  console.log = before;
  return handler.run();
}
out.print("a field that holds a function, stored to by what console.log is now: " + otherFunction());

const table = { pick: (n: number) => n + 1 };
function otherFunctionInALiteral() {
  const before = console.log;
  console.log = (...values: unknown[]) => { (values[0] as any).pick = (n: number) => n * 100; };
  console.log(table);
  console.log = before;
  return table.pick(2);
}
out.print("the same of a literal, through any: " + otherFunctionInALiteral());
