// A sum whose parts so far are all empty is not the string that is added to it: nothing is written into that.
const pieces = ["", "", "hello world".slice(0, 9) + "!", "abc" + String(Date.now() > 1 ? 0 : 1), "x"];
console.log(pieces[2].charCodeAt(2), pieces[3].charCodeAt(0));
function part(i) { if (i > 100) console.log(i); return pieces[i]; }
function f(i, j, k, l) { let s = `${part(i)}${part(j)}`; s += part(k); s += part(l); s += part(k); s += part(l); return s; }
function g(a, b, c, d) { let s = a + b; if (d.length > 100) console.log(a); s += c; if (d.length > 101) console.log(b); s += d; if (d.length > 102) console.log(c); s += c; if (d.length > 103) console.log(c); return s + d; }
for (let t = 0; t < 4; t++) {
  console.log(JSON.stringify(f(0, 1, 2, 3)), JSON.stringify(pieces));
  console.log(JSON.stringify(g(pieces[0], pieces[1], pieces[2], pieces[3])), JSON.stringify(pieces));
  console.log(JSON.stringify(f(0, 4, 2, 3)), JSON.stringify(pieces));
  console.log(JSON.stringify(f(2, 0, 1, 3)), JSON.stringify(pieces));
}
