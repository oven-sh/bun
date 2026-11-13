// A class that extends Array, whose methods read and store its elements in loops: every kind of element, holes, accessors, other prototypes, proxies.
const log = [];
function num(v) { return typeof v === "number" ? v : v === undefined ? 1000 : v === null ? 2000 : typeof v === "string" ? v.length : typeof v === "object" ? 10 + (Array.isArray(v) ? v.length : 0) : 3; }
class Rows extends Array {
  constructor(r, fill) { super(r); for (let i = 0; i < r; i++) if (fill(i) !== log) this[i] = fill(i); this.rows = r; }
  get(i, j) { return this[i][j]; }
  at0(i) { return this[i]; }
  set(i, j, v) { this[i][j] = v; return this; }
  put(i, v) { this[i] = v; return this; }
  sum() { let t = 0; for (let i = 0; i < this.length; i++) t += num(this[i]); return t; }
}
class Heir extends Rows { at0(i) { return super.at0(i); } first() { return this[0]; } }
function attempt(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
function elements(m, n) { let t = 0; for (let i = 0; i < n; i++) t += num(m.at0(i % 4)); return t; }
function cells(m, n) { let t = 0; for (let i = 0; i < n; i++) { const x = m.get(i & 3, i & 1); t += num(x); } return t; }
function products(m, n) { let s = 0; const c = [1.5, 2]; for (let i = 0; i < n; i++) s += m.get(i & 3, i & 1) * c[i & 1]; return s; }
function stores(m, n) { for (let i = 0; i < n; i++) m.set(i & 3, 1, i / 2); return m.sum(); }
function puts(m, n) { for (let i = 0; i < n; i++) m.put(i & 3, i & 1 ? i : i / 2); return m.sum(); }
const fills = { rows: (i) => [i, i + 0.5], ints: (i) => i, doubles: (i) => i + 0.25, texts: (i) => "t" + i, mixed: (i) => (i & 1 ? [i, , 2] : "ab"), holes: (i) => (i & 1 ? log : [i, 1]), objects: (i) => ({ 0: i, 1: i * 2 }), views: (i) => new Float64Array([i, 1.5]) };
const changes = {
  nothing() {}, element(m) { m[1] = [7, 8]; }, gone(m) { delete m[2]; }, short(m) { m.length = 2; }, long(m) { m[9] = 4; }, frozen(m) { Object.freeze(m); }, sealed(m) { Object.seal(m); },
  accessor(m) { Object.defineProperty(m, 0, { get() { log.push("read"); return [4, 5]; }, set() { log.push("stored"); }, configurable: true }); }, plain(m) { Object.setPrototypeOf(m, Array.prototype); m.at0 = (i) => i; m.get = (i, j) => i + j; m.set = m.put = () => m; m.sum = () => -1; },
  other(m) { Object.setPrototypeOf(m, { at0: (i) => i * 2, get: (i, j) => j, set() { return this; }, put() { log.push("put"); }, sum: () => -2, 1: "above" }); }, own(m) { m.get = (i, j) => i * j; m.at0 = () => 55; }, field(m) { m.rows = "2"; m.extra = 1; }, number(m) { m[0] = { valueOf() { log.push("valueOf"); return 6; }, 0: 1, 1: 2 }; },
};
for (const fill of Object.keys(fills)) {
  for (const change of Object.keys(changes)) {
    for (const make of [Rows, Heir]) {
      const m = attempt(() => 0) && new make(4, fills[fill]);
      const before = [attempt(() => elements(m, 40)), attempt(() => cells(m, 40)), attempt(() => products(m, 24))];
      const changed = attempt(() => changes[change](m));
      const behind = [attempt(() => elements(m, 24)), attempt(() => cells(m, 24)), attempt(() => products(m, 24)), attempt(() => stores(m, 12)), attempt(() => puts(m, 13)), attempt(() => elements(m, 8)), m.length, Array.isArray(m), m instanceof Rows];
      console.log(fill, change, make.name, before.join(), changed, behind.join());
    }
  }
}
Rows.prototype.at0 = function (i) { log.push("replaced"); return i; };
console.log(elements(new Rows(4, fills.ints), 8), log.length);
Rows.prototype[3] = "above";
const holed = new Rows(4, (i) => (i === 3 ? log : i));
console.log(holed[3], holed.sum(), attempt(() => elements(new Heir(4, (i) => (i === 3 ? log : i)), 8)), [...new Set(log)].join(), log.length);
