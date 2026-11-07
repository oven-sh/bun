globalThis.said.push("asker");
exports.first = 1;
globalThis.said.push("got:" + typeof require(process.env.MADE_UP_NONE || "./asked.mjs").value);
exports.second = 2;
