(globalThis.runs ??= []).push(String(module.id).includes("?actual") ? "copy" : "own");
exports.kept = "real";
exports.token = {};
