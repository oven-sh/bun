class BelowWeakMap extends WeakMap {}
class BelowDate extends Date {}
class BelowRegExp extends RegExp {}
class BelowSet extends Set {}
class BelowError extends RangeError {}
const tests = {
  weakMap(x) { return x instanceof WeakMap; },
  date(x) { return x instanceof Date; },
  regExp(x) { return x instanceof RegExp; },
  set(x) { return x instanceof Set; },
  error(x) { return x instanceof Error; },
  view(x) { return x instanceof DataView; },
};
globalThis.kept = tests;
const firsts = { weakMap: new BelowWeakMap(), date: new BelowDate(0), regExp: new BelowRegExp("a"), set: new BelowSet(), error: new BelowError("e"), view: { __proto__: DataView.prototype } };
for (const name of Object.keys(firsts)) console.log(name, globalThis.kept[name](firsts[name]), globalThis.kept[name](firsts[name]), globalThis.kept[name]({}), globalThis.kept[name](undefined), globalThis.kept[name](7));
