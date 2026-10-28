// A `return` at the top of a CommonJS file, between two stores.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("returns", () => { const m = require("./returns.js"); return [m.a, m.b]; });
