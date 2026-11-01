// %TypedArray%.of is called on a method, which is no constructor, and on another typed array class.
const TypedArray = Object.getPrototypeOf(Int8Array);
const m = { m() {} }.m;
try {
  TypedArray.of.call(m, []);
  console.log("no throw");
} catch (e) {
  console.log("threw", e instanceof TypeError, String(e).slice(0, 60));
}
try {
  Int8Array.of.call(m, 1, 2);
  console.log("no throw");
} catch (e) {
  console.log("threw", e instanceof TypeError);
}
try {
  console.log(Int8Array.of.call(Uint8Array, 1, 300).join());
} catch (e) {
  console.log("threw", String(e));
}
