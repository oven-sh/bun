// Text that the compiler has not seen gives a function a name, a length and a bind of its own. Every bind behind that has to see them.
function add(a, b, c) { return a + b + c; }
function scale(a, b) { return a * b; }
function report(label, f) { console.log(label, typeof f, f.name, f.length, f(1, 2)); }
report("before", add.bind(null, 10));
report("before", scale.bind(null, 10));
const rename = Function("f", process.argv[7] ?? "Object.defineProperty(f, 'name', { value: 'renamed' }); Object.defineProperty(f, 'length', { value: 7 });");
const hijack = Function("f", process.argv[8] ?? "f.bind = function () { return function hijacked() { return 'hijacked'; }; };");
const reparent = Function("f", process.argv[9] ?? "Object.setPrototypeOf(f, { bind() { return function fromOtherPrototype() { return 'other prototype'; }; } });");
for (let round = 0; round < 3; round++) {
  if (round === 1) { rename(add); hijack(scale); }
  if (round === 2) reparent(add);
  report("round " + round, add.bind(null, 10));
  report("round " + round, scale.bind(null, 10));
}
