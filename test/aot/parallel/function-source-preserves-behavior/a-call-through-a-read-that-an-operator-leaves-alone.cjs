// Flags: --minify-syntax
// A call through a read out of a literal, where `||` or `??` leaves the read alone: what `toString()` gives still calls without the literal as `this`.
const cases = {
  underOr: function () { return ([function () { return Array.isArray(this); }][0] || 0)(); },
  underNullish: function () { return ([function () { return Array.isArray(this); }][0] ?? 0)(); },
  outOfAnObject: function () { return ({ b: function named() { return this !== undefined && this !== globalThis; } }.b || 0)(); },
};
for (const [name, f] of Object.entries(cases)) {
  const again = new Function("return (" + String(f) + "\n)")();
  console.log(name + ": " + f() + " | " + again());
}
