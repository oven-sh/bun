const baseName = path => String(path).replace(/^.*[\\/]/, "");
exports.describe = (module, main) => [main === module, baseName(module.id), baseName(module.filename)].join(" ");
