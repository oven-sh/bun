globalThis.said.push("asker");
exports.first = 1;
globalThis.said.push("got:" + typeof require(new (class { path = "./asked.mjs"; })().path).value);
exports.second = 2;
