function record() {
  return {
    whole: 1, negative: -1, zero: 0, minusZero: -0, fraction: 0.1, huge: 1e21, tiny: 5e-324, beyondInt32: 4294967296, notANumber: NaN, endless: Infinity,
    yes: true, no: false, nothing: null, missing: undefined, empty: "", letter: "a", word: "word", long: "a rather long text that is no identifier, with spaces", unicode: "héllo 世界 😀",
    big: 123456789012345678901234567890n, smallBig: 0n, list: [1, 2, 3], fractions: [0.5, 1.5], words: ["x", "y"], mixed: [1, "a", null, undefined, true, 2n, [], {}], holes: [1, , 3], none: [], inner: { a: 1, b: { c: 2, d: { e: [3, { f: 4 }] } } }, blank: {},
  };
}
function odd(): Record<string, unknown> {
  return { 0: "zero", 1: "one", 10: "ten", "2": "two", "-1": "minus", "1.5": "fraction", "a b": "space", "": "empty", constructor: "c", toString: "t", valueOf: 1, hasOwnProperty: 2, length: 3, name: "n", prototype: "p", a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 };
}
function withProto(): any { return { __proto__: null, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17 }; }
function quotedProto(): any { return { "__proto__": { up: 1 }, a: 1, b: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] }; }
function computedProto(): any { return { ["__proto__"]: 5, a: 1, b: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] }; }
const show = (v: unknown): string => typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : typeof v === "number" ? String(v) : typeof v === "string" ? JSON.stringify(v) : v === null ? "null" : typeof v === "boolean" ? String(v) :
  Array.isArray(v) ? "[" + Array.from({ length: v.length }, (_, i) => i in v ? show(v[i]) : "<hole>").join() + "]" : "{" + Reflect.ownKeys(v as object).map(k => String(k) + ":" + show((v as any)[k])).join() + "}";
for (const make of [record, odd, withProto, quotedProto, computedProto]) {
  const a: any = make(), b: any = make();
  console.log(make.name, show(a)); console.log(make.name, a !== b, show(a) === show(b), Object.getPrototypeOf(a) === Object.prototype, Object.getPrototypeOf(a) === null, Object.keys(a).length);
  for (const k of Object.keys(a)) { if (typeof a[k] === "object" && a[k] !== null) console.log(make.name, k, a[k] !== b[k]); a[k] = "overwritten"; }
  console.log(make.name, show(b) === show(make()), show(a) !== show(b));
}
console.log(quotedProto().up, computedProto().up, Object.keys(computedProto()).join(), typeof record().big, record().big === record().big, record().big * 2n);
