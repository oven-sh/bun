// `module.exports = { .. }`, getters and helpers that are almost of the form that needs no object.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("counting", () => { const m = require("./counting"); return [m.count, m.count]; });
show("ofobject", () => [require("./ofobject").v, require("./object").keys()]);
show("getterstored", () => { const m = require("./getterstored"); return [m.p, m.threw]; });
show("hidden", () => [require("./hidden").p, require("./hiddenuser").keys]);
show("ownhelper", () => require("./ownhelper").seen);
show("earlyhelper", () => require("./earlyhelper").seen);
show("boxused", () => require("./boxused").seen);
show("litandexports", () => { const m = require("./litandexports"); return [m.lost, m.kept, m.alsoLost]; });
show("litbefore", () => { const m = require("./litbefore"); return [m.lost, m.kept]; });
show("litspread", () => { const m = require("./litspread"); return [m.a, m.b, m.c1, m.d]; });
show("littwice", () => { const m = require("./littwice"); return [m.a, m.gone]; });
show("litthis", () => { const m = require("./litthis"); return [m.who(), m.f()]; });
show("litself", () => require("./litself").b);
show("litlate", () => { const m = require("./litlate"); return [m.a, m.fromEarly]; });
show("litcycle", () => { const m = require("./litcycle_a"); return [m.name, m.seenByB, m.lateByB()]; });
show("litproto", () => { const m = require("./litproto"); return [m.inherited, m.own]; });
