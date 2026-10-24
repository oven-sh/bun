// One element of a hundred thousand is an object out of JSON.parse with its fields in another order.
class P { constructor(a, b) { this.a = a; this.b = b; } }
function sum(list) {
  let total = 0;
  let scale = list[0].b;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    total = (total + p.a * scale + p.b) | 0;
  }
  return total;
}
const list = [];
for (let i = 0; i < 100000; i++) list.push(i === 10 ? JSON.parse('{"b":1,"a":2,"c":3}') : new P(i, 1));
let r = 0;
for (let k = 0; k < 200; k++) r = (r + sum(list)) | 0;
console.log(r);
