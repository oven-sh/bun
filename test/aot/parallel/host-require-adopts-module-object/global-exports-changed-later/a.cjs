(globalThis.leaves ??= {}).a = module;
exports.count = 1;
globalThis.bump = () => { exports.count++; module.exports.extra = true; };
