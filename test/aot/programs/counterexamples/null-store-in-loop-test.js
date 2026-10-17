// `h.f = g` in the test of a loop throws a TypeError once h is null.
function run(h, g) {
  while ((h.f = g, h)) { const k = h; h = null; g = () => k; }
}
try { run({}); console.log("no error"); } catch (e) { console.log(e.constructor.name); }
