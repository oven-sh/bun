// TypeScript's `__exportStar` where it is not the plain case: a helper of the file's own, a star that runs late, in a cycle, of an object.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("ownstar", () => { const m = require("./ownstar"); return [m.custom, m.p]; });
show("almost", () => require("./almost").p);
show("latestar", () => { const m = require("./latestar"); const before = m.p; m.load(); return [before, m.p]; });
show("after", () => { const m = require("./after"); return [m.p, m.late, m.threw]; });
show("ofmaybe", () => { const m = require("./ofmaybe"); return [m.maybe, m.sure]; });
show("ofobject", () => { const m = require("./ofobject"); return [m.o, m.keys()]; });
show("looked", () => Object.keys(require("./looked")).join());
show("cycle", () => { const m = require("./cyc_a"); return [m.a, m.b, m.sawA]; });
