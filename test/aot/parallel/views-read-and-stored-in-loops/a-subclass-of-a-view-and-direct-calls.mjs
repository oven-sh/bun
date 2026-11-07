const unseen = (x) => [x][JSON.parse("0")];
let heard = 0;
const each = unseen((i) => { heard += i; });
class Frame extends Int32Array {}
function scaled(view, n) { let sum = 0; for (let i = 0; i < n; i++) { each(i); sum = (sum + view[i] * view.length) | 0; } return sum; }
function framed(view, n) { let sum = 0; for (let i = 0; i < n; i++) { each(i); sum = (sum + view[i] * view.byteLength) | 0; } return sum; }
const below = () => Object.setPrototypeOf(new Int32Array([1, 2, 3]), Object.create(Int32Array.prototype));
for (let round = 0; round < 2; round++) {
  console.log(scaled(new Int32Array([1, 2, 3]), 3), scaled(below(), 3));
  console.log(framed(new Int32Array([1, 2, 3]), 3), framed(new Frame([1, 2, 3]), 3));
}
console.log(heard);
