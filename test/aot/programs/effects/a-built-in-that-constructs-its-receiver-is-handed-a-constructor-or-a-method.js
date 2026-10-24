// A built-in constructs its `this`. What runs then writes a variable of the module, which the caller reads in front of the call and behind it.
let counter = 0;
const box = { n: 0 };
function C(length) { counter++; box.n++; return new Int8Array(length); }
const m = { m() {} }.m;
let turn = 0;
function pick() { return turn++ % 2 ? m : C; }
function ask() {
  const before = counter, boxBefore = box.n;
  try { Int8Array.of.call(pick(), 1, 2); } catch (error) { console.log(error.name); }
  return (counter - before) + " " + (box.n - boxBefore);
}
console.log(ask(), ask());
