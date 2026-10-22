// `module.id`, `this` of a call through `module.exports`, and `delete module.exports`.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("id", () => { const m = require("./id"); return [m.t]; });
show("calledthis", () => require("./calledthis").viaModule);
show("deleted", () => typeof require("./deleted"));
