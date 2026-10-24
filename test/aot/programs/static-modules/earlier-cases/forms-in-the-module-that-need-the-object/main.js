// One file for each thing that a CommonJS file can do to its own exports object that names alone cannot express.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("passed", () => { const m = require("./passed.js"); return [m.own, m.added]; });
show("computed", () => { const m = require("./computed.js"); return [m.x, m.y, m.z]; });
show("usesthis", () => { const m = require("./usesthis.js"); const w = m.who; return [m.who(), (0, m.who)(), w(), m.callsOwn()]; });
show("deleted", () => { const m = require("./deleted.js"); return [m.a, m.b, m.has()]; });
show("typeofs", () => require("./typeofs.js").t);
show("proto", () => require("./proto.js").own);
show("local", () => { const m = require("./local.js"); return [m.a, m.b, m.keys()]; });
show("latemarker", () => { const m = require("./latemarker.js"); return [m.__esModule, m.mark(), m.__esModule]; });
show("reassigned", () => { const m = require("./reassigned.js"); return [m.lost, m.kept, m.alsoLost, m.real]; });
show("onevalue", () => { const m = require("./onevalue.js"); return [m(), m.extra, typeof m]; });
show("literal", () => { const m = require("./literal.js"); return [m.a(), m.b]; });
show("getter", () => { const m = require("./getter.js"); return [m.count, m.count]; });
show("frozenmarker", () => { const m = require("./frozenmarker.js"); return [m.threw, m.still]; });
show("valueofmarker", () => require("./valueofmarker.js").same);
show("orself", () => require("./orself.js").seen);
