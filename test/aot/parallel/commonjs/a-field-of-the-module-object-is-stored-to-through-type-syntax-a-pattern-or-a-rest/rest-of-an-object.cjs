({ ...module.id } = { a: 1 });
exports.read = String(JSON.stringify(module.id));
