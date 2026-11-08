// STATISTIC: AssignmentsWrittenOutFieldByField >= 2
interface Options { depth: number; width: number; color: boolean }
const DEFAULTS: Options = { depth: 2, width: 80, color: false };
let reads = 0, work = 0;
function merge(given: Options) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.assign({ tag: 1 }, DEFAULTS, given);
}
function only(given: Options) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.assign({ tag: 1 }, given);
}
function fresh(): Options { return { depth: 1, width: 2, color: true }; }
function show(o: any): string {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Object.keys(o).join() + "|" + o.depth + "|" + o.width + "|" + o.color + "|" + o.extra;
}
const deeds: ((x: any) => Options)[] = [
  (x) => x,
  () => ({ color: true, width: 2, depth: 1 }),
  (x) => Object.defineProperty(x, "width", { get() { return ++reads; }, enumerable: true, configurable: true }),
  (x) => Object.defineProperty(x, "depth", { enumerable: false }),
  (x) => { delete x.depth; x.depth = 5; return x; },
  (x) => { x.extra = 6; return x; },
  (x) => { x[0] = "zero"; return x; },
  (x) => Object.freeze(x),
  () => JSON.parse('{"width":7,"extra":8,"depth":0}'),
];
let sum = 0;
for (let i = 0; i < 300; i++) sum += merge(fresh()).width + only(fresh()).depth;
console.log(sum);
for (const deed of deeds) console.log(show(merge(deed(fresh()))) + " " + show(only(deed(fresh()))));
