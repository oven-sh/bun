"use strict";
exports.requirePlain = function () { const t = require("./plain"); return String(t.__esModule) + " " + t.a + " " + ("__esModule" in t) + " " + Object.keys(t).join(); };
exports.requireWhole = function () { const w = require("./whole"); return typeof w + " " + w() + " " + w.extra + " " + String(w.beside); };
exports.requireSays = function () { const t = require("./says"); return String(t.__esModule) + " " + t.s + " " + Object.keys(t).join(); };
exports.describe = function () { const t = require("./plain"), d = Object.getOwnPropertyDescriptor(t, "__esModule"); const seen = []; for (const k in t) seen.push(k); return [d ? Object.keys(d).sort().join("+") + ":" + d.enumerable : "none", JSON.stringify(t), seen.join(), Object.getOwnPropertyNames(t).join()].join(" "); };
exports.remove = function () { "use strict"; const t = require("./plain"); let removed; try { removed = String(delete t.__esModule); } catch (e) { removed = e.constructor.name; } return removed + " " + String(t.__esModule) + " " + Object.prototype.hasOwnProperty.call(t, "__esModule"); };
