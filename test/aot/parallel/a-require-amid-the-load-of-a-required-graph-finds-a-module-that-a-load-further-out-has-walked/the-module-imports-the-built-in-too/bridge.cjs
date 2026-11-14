(globalThis.order ??= []).push("bridge<");
try { const it = require("./panel.mjs"); (globalThis.order ??= []).push("bridge got " + Object.keys(it).join()); } catch (error) { (globalThis.order ??= []).push("bridge caught " + error.name); }
(globalThis.order ??= []).push("bridge>");
module.exports = "bridge";
