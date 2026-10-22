// `exports.f = f` ahead of the requires of the file, as TypeScript emits it, where `f` is called before those requires have run.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("called", () => { const m = require("./called"); return [m.before, m.after]; });
show("handed", () => require("./handed").got);
show("global", () => require("./global").got);
show("getter", () => require("./getter").before);
show("cls", () => require("./cls").before);
show("inner", () => { const m = require("./inner"); return [m.f(true), m.f(false)]; });
