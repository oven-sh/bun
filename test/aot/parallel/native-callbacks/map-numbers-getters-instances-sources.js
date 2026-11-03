// The values of the pairs come out of getters, one of them defined later, and out of the fields of an instance that a method raises past an int32.
const log = [];
class Sizes { constructor() { this.w = 1; this.h = 2147483647; } grow() { this.h += 1; return this; } }
const withGetter = { plain: 1, get big() { return 8589934592; } };
Object.defineProperty(withGetter, "defined", { get() { return 0.5; }, enumerable: true });
const a = new Map(Object.entries(withGetter)), b = new Map(Object.entries(new Sizes().grow()));
log.push(a.get("big") + 1, a.get("defined") * 2, a.get("plain") + 1, b.get("h") + 1, b.get("h") | 0, b.get("w"));
console.log(log.join("; "));
