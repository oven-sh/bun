// Names of every kind are written as json keys.
const sym = Symbol("s");
function a(n: number) { return { plain: n, "with space": n, "qu\"ote": n, "back\\slash": n, "tab\tkey": n, "café": n, "中": n, "": n, "del\u007f": n, [sym]: n, last: n }; }
function b(n: number) { return { "\n": n, x: n, "\u0000": n, y: { "a\"": n, b: [n] } }; }
function c(o: object) { return { ...o, extra: 1 }; }
for (let i = 0; i < 3; i++) {
  console.log(JSON.stringify(a(i)), JSON.stringify(b(i)), JSON.stringify(c(a(i))), JSON.stringify(c(b(i)), null, 1).length, Object.keys(c(a(i))).join("|"));
}
