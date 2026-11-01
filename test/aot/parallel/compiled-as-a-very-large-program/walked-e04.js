// Flags: --aot-heat=ReadOffStructure
// The name that a walk hands out is kept in a member, in a function that a very large program ranks cold. One of 22 forms; walked-key.js says what went wrong.
function r72make() { return { p: "start", n: 0, a: 1, b: 2, c: 3 }; }
function r72f(x, n) {
  for (x.p in { worda: 1 }) { x.n += n; }
  return x.n; }
function r72same(a, b) { return a.p === b.p; }
const r72a = r72make(), r72b = r72make(); let r72out = "";
r72out += r72f(r72a, 1) + ";" + (r72same(r72a, r72b) ? "Y" : "N");
r72out += r72f(r72a, 4) + ";" + (r72same(r72a, r72b) ? "Y" : "N");
console.log("R=" + r72out + r72a.p);
