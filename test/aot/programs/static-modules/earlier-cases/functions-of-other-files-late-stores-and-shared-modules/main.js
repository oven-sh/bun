// Functions of another file stored as exports, a name stored late by a callback, and two modules that share a third.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("foreign", () => { const m = require("./foreign"); return [m.f(), (0, m.f)(), m.g(), (0, m.g)()]; });
show("late", () => { const m = require("./late"); let run; const before = m.late; m.arm(f => { run = f; }); const between = m.late; run(); return [before, between, m.late]; });
show("group", () => { const first = require("./first"), second = require("./second"), shared = require("./shared"); const before = first.a(); second.touch(); return [before, first.a(), shared.read()]; });
show("blocks", () => { let out = []; { const { a } = require("./blocks"); out.push(a); } { const { a, b } = require("./blocks"); out.push(a + b); } if (out.length) { const { b: a } = require("./blocks"); out.push(a); } return out; });
show("tested", () => { const m = require("./tested"); return [m || "no", m ?? "nil", m == null, m === undefined, m !== null, Boolean(m), m instanceof Object, [m].length, typeof m]; });
