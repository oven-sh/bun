function nameOfConstructor(o) {
  const d = Object.getOwnPropertyDescriptor(o, "constructor");
  if (d !== undefined && typeof d.value === "function" && d.value.name !== "") return d.value.name;
  return "none";
}
function walk(o) {
  let depth = 0;
  while (o !== null) {
    const d = Object.getOwnPropertyDescriptor(o, "constructor");
    if (d !== undefined && typeof d.value === "function" && d.value.name !== "") return d.value.name + depth;
    o = Object.getPrototypeOf(o); depth++;
  }
  return "end";
}
class K {}
for (const v of [K.prototype, {}, new K(), Object.create(null), Object.defineProperty({}, "constructor", { get() { return K; } }), { constructor: 5 }, { constructor: function () {} }]) console.log(nameOfConstructor(v), walk(v));
