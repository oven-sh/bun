// Fields that every statement in sight stores numbers, booleans or objects into are read by name off receivers of which nothing is known, some hundred times, so that the place of each read has its answer. Then each field meets what its form does not hold.
class Point {
  whole = 1;
  wide = 5000000000;
  part = 0.5;
  on = false;
  next: Point | null = null;
}
class Other {
  part = "text";
  whole = "one";
  wide = "two";
  on = "three";
  next = "four";
}
function make(i: number) {
  const point = new Point();
  point.whole = i;
  point.wide = 5000000000 + i;
  point.part = i / 4;
  point.on = i % 3 === 0;
  point.next = i % 2 ? point : null;
  return point;
}
function readWhole(o: any) { return o.whole; }
function readWide(o: any) { return o.wide; }
function readPart(o: any) { return o.part; }
function readOn(o: any) { return o.on; }
function readNext(o: any) { return o.next; }
function show(o: any) {
  const next = readNext(o);
  return [readWhole(o), readWide(o), Object.is(readPart(o), -0) ? "-0" : readPart(o), readOn(o), next === o ? "itself" : next === null ? "null" : typeof next].join(" ");
}
let sum = 0;
for (let i = 0; i < 600; i++) {
  const point = make(i);
  sum += readWhole(point) + readWide(point) + readPart(point) + (readOn(point) ? 1 : 0) + (readNext(point) === point ? 1 : 0);
}
console.log(sum);
console.log(show(make(7)), "|", show(make(12)), "|", show(new Other()));

const edges = make(1);
edges.whole = -2147483648;
console.log(show(edges));
edges.whole = 2147483647;
edges.wide = -9007199254740991;
edges.part = -0;
console.log(show(edges));
edges.part = NaN;
console.log(show(edges));
edges.part = -Infinity;
edges.wide = 3;
console.log(show(edges));
edges.part = 3;
console.log(show(edges), typeof readPart(edges), [10, 20, 30, 40][readPart(edges)]);

const key = ["wh", "ole"].join("");
const deeds: Array<(o: any) => void> = [
  o => { o[key] = "a text"; },
  o => { o[key] = undefined; },
  o => { o[key] = 1.5; },
  o => { delete o[key]; },
  o => { delete o.part; delete o.on; delete o.next; delete o.wide; },
  o => { Object.defineProperty(o, "wide", { get() { return "got"; }, configurable: true }); },
  o => { Object.defineProperty(o, "on", { value: "fixed", writable: false }); },
  o => { o["ne" + "xt"] = 12; },
  o => { o["pa" + "rt"] = null; },
  o => { Object.setPrototypeOf(o, { whole: "above", part: "above" }); delete o.whole; delete o.part; },
  o => { Object.freeze(o); },
];
for (const deed of deeds) {
  const point = make(9);
  deed(point);
  console.log(show(point), "|", show(make(9)));
}
