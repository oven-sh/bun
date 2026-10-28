exports.before = [module.id, module.filename, module.loaded];
Object.assign(module, { id: "a id", filename: "a filename" });
exports.after = () => [module.id, module.filename, module.loaded];
