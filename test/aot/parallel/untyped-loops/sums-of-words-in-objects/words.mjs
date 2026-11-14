export const state = { calls: 0 };
const Root = {
  extend(overrides) { const o = Object.create(this); if (overrides) o.mixIn(overrides); return o; },
  create(...values) { const o = this.extend(); o.init.apply(o, values); return o; },
  init() {},
  mixIn(properties) { for (const name in properties) this[name] = properties[name]; },
};
export const Base = Root.extend({ init: function (high, low) { this.high = high; this.low = low; } });
const names = ["high", "low"];
const fill = (o, h, l) => { names.forEach((name, k) => { o[name] = k ? l : h; }); return o; };
class Declared { constructor(h, l) { fill(this, h, l); } }
const accessor = (h, l) => {
  const o = fill({}, h, l);
  Object.defineProperty(o, names[0], { enumerable: true, get() { state.calls++; return h; }, set(v) { state.calls++; h = v; } });
  return o;
};
const traps = { get(t, k) { state.calls++; return t[k]; }, set(t, k, v) { state.calls++; t[k] = v; return true; } };
export const makers = {
  created: (h, l) => Base.create(h, l),
  init: (h, l) => new Base.init(h, l),
  declared: (h, l) => new Declared(h, l),
  literal: (h, l) => fill({}, h, l),
  swapped: (h, l) => { const o = {}; o[names[1]] = l; o.name = 1; o[names[0]] = h; return o; },
  dictionary: (h, l) => { const o = fill({ gone: 1 }, h, l); delete o.gone; return o; },
  accessor,
  proxy: (h, l) => new Proxy(fill({}, h, l), traps),
  frozen: (h, l) => Object.freeze(fill({}, h, l)),
  inherited: (h, l) => Object.create(fill({}, h, l)),
  absent: () => ({}),
  list: (h, l) => fill([1], h, l),
  number: () => 5,
  nothing: () => undefined,
};
const thrower = { valueOf() { state.calls++; throw new RangeError("thrown"); } };
export const kinds = {
  ints: [1, 2, 3, 4],
  big: [4294967295, 2147483648, 3000000000, -2147483648],
  wide: [2 ** 32, 2 ** 40 + 5, -(2 ** 33) - 7, 2 ** 48],
  edge: [2 ** 49, 2 ** 49 + 1, -(2 ** 49), -(2 ** 49) - 1],
  beyond: [2 ** 53, 2 ** 53 + 2, 2 ** 60, -(2 ** 70)],
  fractions: [0.5, -0.5, 1e9 + 0.25, -0],
  odd: [NaN, Infinity, -Infinity, -0],
  strings: ["1", "0x10", "", "abc"],
  nullish: [undefined, null, true, false],
  bigints: [1n, 2n, 3n, 4n],
  throwing: [1, 2, thrower, 4],
};
export const show = v => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "obj" : String(v);
export const shown = w => w === null || typeof w !== "object" ? String(w) : show(w.high) + ":" + show(w.low) + "/" + Object.keys(w).length;
