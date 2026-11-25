(globalThis.order ??= []).push("<bridge");
exports.panel = require("./panel.mjs").panel;
(globalThis.order ??= []).push("bridge>");
