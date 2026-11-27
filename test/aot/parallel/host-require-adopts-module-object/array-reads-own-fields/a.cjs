(globalThis.leaves ??= {}).a = module;
exports.name = "a";
console.log("SAID a sees loaded", module.loaded, "id", String(module.id).replace(/^.*[\\/]/, ""), "filename", String(module.filename).replace(/^.*[\\/]/, ""), "require", typeof require, typeof module.require, "exports", module.exports === exports, this === exports, "paths", Array.isArray(module.paths), "main is a", require.main === module, "dirname", typeof __dirname);
