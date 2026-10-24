// The first argument is an object out of JSON.parse and is read in front of a loop that does not use it.
class P { constructor(a, b) { this.a = a; this.b = b; } }
function work(p, q, n) {
  let total = (p.a + p.b) | 0;
  const scale = q.a;
  for (let i = 0; i < n; i++) total = (total + q.b * scale + i) | 0;
  return total;
}
const odd = JSON.parse('{"b":1,"a":2,"c":3}');
const q = new P(3, 4);
let r = work(new P(1, 2), q, 10);
for (let k = 0; k < 2000; k++) r = (r + work(odd, q, 10000)) | 0;
console.log(r);
