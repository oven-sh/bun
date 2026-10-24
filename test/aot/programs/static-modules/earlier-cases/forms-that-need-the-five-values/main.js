// A direct eval, the module object, `this` in an arrow and in sloppy functions, and an exports object that is passed on.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("evals", () => require("./evals.js").viaEval);
show("moduleobject", () => require("./moduleobject.js").m);
show("arrowthis", () => require("./arrowthis.js").f());
show("sloppythis", () => { const m = require("./sloppythis.js"); return (0, m.who)(); });
show("main_check", () => require("./main_check").isMain);
show("passed", () => require("./passed").filled);
