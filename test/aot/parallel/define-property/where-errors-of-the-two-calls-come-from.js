// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) on one line: an error says which of the two calls it comes from, whether
// the function itself throws it or code of the program that runs inside.
function place(error) {
  const found = /:(\d+):(\d+)\)?$/.exec(String(error.stack).split("\n").filter(line => /mergeOnOneLine/.test(line))[0] || "");
  return error.constructor.name + " " + (found ? found[1] + ":" + found[2] : "nowhere");
}
// The outer call is no tail call: the frame of this function is there when it throws.
let merges = 0;
function mergeOnOneLine(target, source) { const merged = Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); merges++; return merged; }
function placeOfError(target, source) {
  try {
    mergeOnOneLine(target, source);
    return "no error";
  } catch (error) {
    return place(error);
  }
}
const thrower = trap => ({ [trap]() { throw new RangeError(trap); } });
console.log("the inner call refuses its operand:", placeOfError({}, undefined), "|", placeOfError({}, null));
console.log("a trap of the source throws:", placeOfError({}, new Proxy({ a: 1 }, thrower("ownKeys"))), "|", placeOfError({}, new Proxy({ a: 1 }, thrower("getOwnPropertyDescriptor"))));
console.log("the outer call refuses its operand:", placeOfError(undefined, { a: 1 }), "|", placeOfError(null, { a: 1 }), "|", placeOfError(7, { a: 1 }), "|", placeOfError("text", { a: 1 }));
console.log("both refuse:", placeOfError(null, null), "|", placeOfError(undefined, new Proxy({}, thrower("ownKeys"))));
console.log("a trap of the target throws:", placeOfError(new Proxy({}, thrower("defineProperty")), { a: 1 }));
console.log("the target refuses a property:", placeOfError(Object.freeze({}), { a: 1 }), "|", placeOfError(Object.freeze({ a: 1 }), { a: 2 }), "|", placeOfError(Object.preventExtensions({ a: 1 }), { a: 2, b: 3 }));
console.log("the target refuses the second of two:", placeOfError(Object.defineProperty({}, "b", { value: 1 }), { a: 1, b: 2 }));
console.log("an array refuses its length:", placeOfError([], { length: -1 }));
console.log("nobody refuses:", placeOfError({}, { a: 1 }), "|", placeOfError({}, "ab"), "|", placeOfError({}, 7), "|", placeOfError(new Proxy({}, {}), new Proxy({ a: 1 }, {})));
for (const target of [null, undefined, 7]) {
  let result = "nothing";
  try {
    result = mergeOnOneLine(target, { a: 1 });
  } catch (error) {
    result = "caught " + error.name;
  } finally {
    console.log("behind the call:", String(target), String(result));
  }
}
console.log("merges that returned:", merges);
