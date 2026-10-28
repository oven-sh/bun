globalThis.legacyEvaluations = (globalThis.legacyEvaluations ?? 0) + 1;
exports.name = "legacy";
exports.moduleId = module.id;
exports.moduleRequireType = typeof module.require;
