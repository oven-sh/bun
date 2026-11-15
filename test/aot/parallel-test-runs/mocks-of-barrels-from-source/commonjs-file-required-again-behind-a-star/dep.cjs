const load = (globalThis.loads = (globalThis.loads ?? 0) + 1);
exports.greet = () => "real#" + load;
