(globalThis.order ??= []).push("tool<");
try { const it = require("./colors.mjs"); (globalThis.order ??= []).push("tool got " + Object.keys(it).join()); } catch (error) { (globalThis.order ??= []).push("tool caught " + error.name); }
try { const it = require("./colors.mjs"); (globalThis.order ??= []).push("tool got " + Object.keys(it).join()); } catch (error) { (globalThis.order ??= []).push("tool caught " + error.name); }
(globalThis.order ??= []).push("tool>");
module.exports = "tool";
