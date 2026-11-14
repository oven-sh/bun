// if (p[0] < least[0]) least[0] = p[0]; if (p[1] < least[1]) ..: both arrays are asked before the first comparison, and the iteration restarts where one is of another kind.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "o" : String(v));
const log = [];
function grow(box, p) {
  if (p[0] < box[0]) box[0] = p[0];
  if (p[1] < box[1]) box[1] = p[1];
  if (p[2] > box[2]) box[2] = p[2];
  return box;
}
function clampTo(p, low, high) {
  if (p[0] < low[0]) p[0] = low[0];
  if (p[0] > high[0]) p[0] = high[0];
  if (p[1] < low[1]) p[1] = low[1];
  if (p[1] > high[1]) p[1] = high[1];
  return p[0] + p[1];
}
function swapIfGreater(a, b) {
  if (a[0] > b[0]) {
    const t = a[0];
    a[0] = b[0];
    b[0] = t;
  }
  if (a[1] > b[1]) a[1] = b[1];
  return a[1];
}
function early(box, p) {
  if (p[0] < box[0]) box[0] = p[0];
  if (p.length < 3) return box[0];
  if (p[2] > box[2]) box[2] = p[2];
  return box[2];
}
const low = [-3.5, 0.5], high = [4.5, 2.25];
function clamps(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p = list[i % list.length];
    p[0] = i * 0.75 - 9;
    s += clampTo(p, low, high);
  }
  return s;
}
function boxes(list, b, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.25 + grow(b, list[i % list.length])[1];
  return s;
}
function swaps(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.25 + swapIfGreater(list[i % list.length], list[(i * 7 + 1) % list.length]);
  return s;
}
function earlies(list, b, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.25 + early(b, list[i % list.length]);
  return s;
}
const fresh = () => [[0.5, 1.5, 2.5], [-0.5, 0.25, 7.5], [3.5, -2.5, 0.75]];
const start = () => [1.25, 1.25, 1.25];
const lists = {
  doubles: () => [fresh(), start()],
  integers: () => [[[1, 2, 3], [-4, 5, 6], [7, -8, 9]], [0, 0, 0]],
  mixed: () => [[[1, 2, 3], [-0.5, 5, 6], [7, -8.5, 9]], start()],
  integersIntoDoubles: () => [[[1, 2, 3], [-4, 5, 6]], start()],
  doublesIntoIntegers: () => [fresh(), [1, 1, 1]],
  texts: () => [[[0.5, "-1", 2], ["a", 1, "9"], [1, 2, 3]], start()],
  short: () => [[[0.5], [-0.5, 1.5], [3.5, -2.5, 7.75]], start()],
  shortBox: () => [fresh(), [1.5]],
  holes: () => [[[0.5, , 2.5], [, 0.25, 7.5]], [1.5, , 1.5]],
  notNumbers: () => [[[NaN, 1.5, NaN], [-0.5, NaN, 7.5], [-Infinity, -0, Infinity]], [NaN, 0, NaN]],
  zeros: () => [[[-0, 0, -0], [0, -0, 0]], [0, 0, -0]],
  alias: () => { const l = fresh(); return [l, l[1]]; },
  views: () => [[new Float64Array([0.5, 1.5, 2.5]), new Float32Array([-0.1, 0.2, 9.3])], new Float64Array(3)],
  getter: () => { const l = fresh(); Object.defineProperty(l[1], 1, { get() { log.push("get"); return -9; }, configurable: true }); return [l, start()]; },
  setter: () => { const b = start(); Object.defineProperty(b, 0, { get: () => 5, set(x) { log.push("set " + x); } }); return [fresh(), b]; },
  frozen: () => [fresh(), Object.freeze(start())],
  objects: () => [[[{ valueOf() { log.push("valueOf"); return -7; } }, 1, 2], [0.5, 1.5, 2.5]], start()],
  big: () => [[[-5n, 1.5, 9n]], start()],
  nothing: () => [[undefined, [0.5, 1.5, 2.5]], start()],
  inherited: () => { const l = fresh(); Object.setPrototypeOf(l[2], { 3: 1, __proto__: Array.prototype }); return [l, start()]; },
};
for (let turn = 0; turn < 2; turn++) {
  for (const key of Object.keys(lists)) {
    const said = [];
    for (const of of [boxes, earlies]) {
      const [list, b] = lists[key]();
      try {
        said.push(show(of(list, b, 25)));
      } catch (e) {
        said.push(e.constructor.name);
      }
      said.push(Array.from(b, show).join());
    }
    for (const of of [clamps, swaps]) {
      const [list] = lists[key]();
      try {
        said.push(show(of(list, 25)));
      } catch (e) {
        said.push(e.constructor.name);
      }
      said.push(list.map(p => (p ? Array.from(p, show).join() : "none")).join(";"));
    }
    console.log(turn, key, said.join(" "));
  }
}
console.log(log.length, log.slice(0, 6).join());
