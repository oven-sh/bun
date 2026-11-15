globalThis.said.push("asker");
exports.first = 1;
globalThis.said.push("got:" + typeof ({ load: require }).load("./asked.mjs").value);
exports.second = 2;
