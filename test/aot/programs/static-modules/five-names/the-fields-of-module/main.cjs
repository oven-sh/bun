// `id`, `filename`, `loaded` and `parent` of the module object, in a required module and in the entry point.
console.log(require("./a.cjs").m, module.id, module.parent, module.loaded);
