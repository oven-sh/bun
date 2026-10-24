// Finally and return overrides.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function f() {
  try { return attempt(() => z.a); } finally { var z = { a: 1 }; }
}
console.log(f());
function g(k) {
  for (;;) { try { if (k) break; var z = { a: 1 }; break; } finally { console.log(attempt(() => z.a)); } }
  return attempt(() => z.a);
}
console.log(g(0), g(1));
