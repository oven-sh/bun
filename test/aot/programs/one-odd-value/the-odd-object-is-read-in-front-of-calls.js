// The first argument is an object out of JSON.parse. Behind its reads the function only uses an object whose class is known, between calls.
class P { constructor(a, b) { this.a = a; this.b = b; } }
let calls = 0;
function note(x) { calls = (calls + x) | 0; if (calls === -1) console.log(calls); }
function work(p, q) {
  let total = (p.a + p.b) | 0;
  const scale = q.a;
  note(total);
  total = (total + q.b * scale) | 0; note(total);
  total = (total + q.b * scale) | 0; note(total);
  total = (total + q.b * scale) | 0; note(total);
  total = (total + q.b * scale) | 0; note(total);
  total = (total + q.b * scale) | 0; note(total);
  total = (total + q.b * scale) | 0; note(total);
  return total;
}
const odd = JSON.parse('{"b":1,"a":2,"c":3}');
const q = new P(3, 4);
let r = work(new P(1, 2), q);
for (let k = 0; k < 3000000; k++) r = (r + work(odd, q)) | 0;
console.log(r);
