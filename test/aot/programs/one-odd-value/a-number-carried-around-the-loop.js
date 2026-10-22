// One field of a hundred thousand holds a string out of JSON.parse. What is read from the field is carried around the loop, so the turns behind the odd one are fast only if the slow path comes back into the loop.
class P { constructor(a, b) { this.a = a; this.b = b; } }
function sum(list) {
  let total = 0;
  let last = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    total = (total + last * 2 + p.b) | 0;
    last = p.a;
  }
  return total;
}
const odd = JSON.parse('["7"]')[0];
const list = [];
for (let i = 0; i < 100000; i++) list.push(new P(i === 10 ? odd : i, 1));
let r = 0;
for (let k = 0; k < 200; k++) r = (r + sum(list)) | 0;
console.log(r);
