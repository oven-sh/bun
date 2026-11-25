const say = (...a: any[]) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
function narrowed(which: boolean) {
  let x: string | number = 1;
  const f = eval("(function () { return typeof x + x; })");
  const before = f();
  x = which ? "text" : 2.5;
  const g = eval("(function () { return x.length; })");
  const after = [f(), g()];
  x = 7;
  return [before, ...after, f(), g()];
}
say(...narrowed(true), ...narrowed(false));
class Point { constructor(public x: number, public y: number) {} }
function points(p: Point | null) {
  if (!p) return eval("(function () { return p; })")();
  const read = eval("(function () { return p && p.x + p.y; })");
  const one = read();
  p = null;
  return [one, read()];
}
say(points(new Point(1, 2)), points(null));
let shared: number[] = [1, 2, 3];
const push = eval("(function (v) { shared.push(v); return shared.length; })");
const replace = eval("(function () { shared = ['a']; })");
say(push(4), push("s"), shared.join()); replace(); say(shared.join(), push(5));
const o = { a: 1 as number, b: "t" };
eval("(function () { o.a = 'changed'; delete o.b; o.c = 3; })")(); say(o.a, o.b, JSON.stringify(o));
const total = eval("(function (list) { let s = 0; for (const p of list) s += p.x * p.y; return s; })"); say(total([new Point(1, 2), new Point(3, 4)]), total([{ x: 2, y: "3" }]));
let counter = 0; const inc = eval("(() => { counter++; })"); for (let i = 0; i < 1000; i++) inc(); say(counter);
function generic<T>(v: T) { return eval("(function () { return v; })") as () => T; } say(generic(1)(), generic("a")());
