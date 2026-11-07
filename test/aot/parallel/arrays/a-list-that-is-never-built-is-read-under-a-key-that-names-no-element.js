// `[a, b][flag]`, and `rest[flag]` in a function that stands in line: a boolean, undefined or null as a key names "true", "false", "undefined" or "null".
// A list that is never built has no property of those names and neither have its prototypes, so the read gives undefined and the list is not made for it.
// A key that may be a text or a number, and a list that got such a property, still find what is there.
// IR= 0 underFlag ElemGet
// IR= 0 underFlag NewArray
// IR= 0 restUnderFlag ElemGet
const unknown = value => JSON.parse(JSON.stringify(value));
function underFlag(n, a, b) { return [a, b][n > 1]; }
function underNothing(a, b) { return String([a, b][undefined]) + [a, b][null]; }
function underFlagOrNothing(n, a, b) { return [a, b][n > 1 ? n > 2 : n > 0 ? undefined : null]; }
function byFlag(a, ...rest) { const k = a === 1; return rest[k] === undefined ? 1 : 0; }
function restUnderFlag(n) { return byFlag(n, 1, 2, 3) + byFlag(n + 1, 4) * 10 + byFlag(n) * 100; }
function underAnything(key, a, b) { return [a, b][key]; }
function storedUnderFlag(n, a) { const list = [a]; list[n > 1] = "stored"; return [list[n > 1], list[n <= 1], list.length, Object.keys(list).join()].join(" "); }
function definedUnderNull(a) { const list = [a]; Object.defineProperty(list, null, { get() { return this.length + 40; } }); return list[null]; }
function ofAnotherPrototype(n, a) { const list = [a]; Object.setPrototypeOf(list, { true: "inherited", false: "too" }); return list[n > 1]; }
// Reached by value, so that each stays a function of its own.
const kept = { underFlag, underNothing, underFlagOrNothing, restUnderFlag, underAnything, storedUnderFlag, definedUnderNull, ofAnotherPrototype };
const call = (name, ...values) => kept[unknown(name)](...values);
for (const n of [0, 1, 2, 3]) {
  console.log(n, call("underFlag", unknown(n), 1, 2), call("underFlagOrNothing", unknown(n), 1, 2), call("restUnderFlag", unknown(n)), call("storedUnderFlag", unknown(n), "a"), call("ofAnotherPrototype", unknown(n), "a"));
}
console.log(call("underNothing", 1, 2), call("definedUnderNull", "a"));
for (const key of [true, false, null, "length", "0", 1, 1.5, -1, "true", "at"]) console.log(JSON.stringify(key), String(call("underAnything", unknown(key), "first", "second")).slice(0, 24));
console.log(String(call("underAnything", undefined, "first", "second")));
