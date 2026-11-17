globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("SAID pool runs", globalThis.runs);
exports.id = globalThis.runs;
exports.query = text => "real " + text + " " + exports.id;
