globalThis.said.push("asker");
exports.first = 1;
globalThis.said.push("got:" + typeof ["./asked.mjs"].map(require)[0].value);
exports.second = 2;
