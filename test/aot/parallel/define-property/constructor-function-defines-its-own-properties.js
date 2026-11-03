// A constructor function defines its own properties through Object.defineProperty, Object.defineProperties and Reflect.defineProperty: values in three forms and a getter.
function Made(turn) {
  Object.defineProperty(this, "b", { value: turn, enumerable: true });
  Object.defineProperties(this, { c: { get() { return 2; }, configurable: true }, y: { value: turn, writable: true } });
  Reflect.defineProperty(this, "z", { value: 3 });
}
let sum = 0;
const turns = Number(process.env.TURNS ?? 625);
for (let turn = 0; turn < turns; turn++) {
  const made = new Made(turn);
  sum += made.b + made.c + made.y + made.z;
}
console.log(sum);
