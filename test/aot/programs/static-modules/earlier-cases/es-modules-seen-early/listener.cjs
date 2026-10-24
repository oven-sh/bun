const registry = require("./registry.cjs");
function probe(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
registry.on(function (what) {
  try { const t = require("./t"); return what + ":" + typeof t + ":" + probe(() => t.a) + "/" + probe(() => t.b) + "/" + probe(() => t.f()) + "/" + probe(() => t.v); }
  catch (e) { return what + ": require threw " + e.constructor.name; }
});
