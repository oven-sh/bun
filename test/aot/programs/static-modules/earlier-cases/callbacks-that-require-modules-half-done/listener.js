var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
const registry = require("./registry");
let kept;
registry.on(function (what) {
  try {
    if (what === "lit") { const t = require("./lit"); return "lit:" + String(t.l); }
    if (what === "get") { const t = require("./get"); return "get:" + String(t.g); }
    if (what === "star") { const t = require("./star"); return "star:" + String(t.g); }
    if (what === "of") { const t = require("./of"); return "of:" + String(t.g); }
    if (what === "latemark") { kept = __importDefault(require("./latemark")); return "latemark:" + typeof kept.default; }
    if (what === "latemark again") { const t = __importDefault(require("./latemark")); return typeof kept.default + "/" + typeof t.default; }
    if (what === "prologue") { const t = require("./prologue"); return "prologue:" + t.f(); }
  } catch (e) { return what + ":" + e.constructor.name; }
  return "";
});
