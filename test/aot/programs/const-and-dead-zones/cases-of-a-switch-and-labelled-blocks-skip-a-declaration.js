// Switch cases share a scope.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function pick(k) {
  switch (k) {
    case 0: let q = { a: 1 };
    case 1: return attempt(() => q.a);
  }
}
console.log(pick(0), pick(1));
function lab(k) {
  out: { if (k) break out; var v = { a: 1 }; }
  return attempt(() => v.a);
}
console.log(lab(0), lab(1));
