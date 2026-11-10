globalThis.said.push("asker<");
exports.a = 1;
globalThis.said.push("root:" + typeof require(process.env.MADE_UP_NONE || "./root.mjs"));
globalThis.said.push("beside:" + typeof require(process.env.MADE_UP_NONE || "./beside.mjs"));
exports.b = 2;
globalThis.said.push("asker>");
