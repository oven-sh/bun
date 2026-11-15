// The first argument is an object out of JSON.parse. A number read from it is used to the end of the function, beside an object whose class is known: that object's reads stay fast only if the slow path of the first read ends early.
class P { constructor(a, b) { this.a = a; this.b = b; } }
let calls = 0;
function note(x) { calls = (calls + x) | 0; if (calls === -1) console.log(calls); }
function work(p, q) {
  const a = p.a;
  let total = p.b | 0;
  note(total);
  total = (total + q.b * a) | 0; note(total);
  total = (total + q.b * a) | 0; note(total);
  total = (total + q.b * a) | 0; note(total);
  total = (total + q.b * a) | 0; note(total);
  total = (total + q.b * a) | 0; note(total);
  total = (total + q.b * a) | 0; note(total);
  return total;
}
const odd = JSON.parse('{"b":1,"a":2,"c":3}');
const q = new P(3, 4);
let r = work(new P(1, 2), q);
for (let k = 0; k < 3000000; k++) r = (r + work(odd, q)) | 0;
console.log(r);
