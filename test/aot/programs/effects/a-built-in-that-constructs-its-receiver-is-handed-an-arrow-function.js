// A built-in constructs its `this`. What runs then writes a variable of the module, which the caller reads in front of the call and behind it.
let counter = 0;
const box = { n: 0 };
const arrow = () => {};
Object.defineProperty(arrow, "prototype", { get() { counter++; box.n++; return null; } });
function ask() {
  const before = counter, boxBefore = box.n;
  try { Int8Array.of.call(arrow, 1); } catch (error) { console.log(error.name); }
  return (counter - before) + " " + (box.n - boxBefore);
}
console.log(ask(), ask());
