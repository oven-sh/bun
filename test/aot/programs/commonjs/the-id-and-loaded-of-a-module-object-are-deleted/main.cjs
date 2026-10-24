// The id and loaded of a module object are deleted.
delete module.id; delete module.loaded;
console.log(module.id, module.loaded, "id" in module, Object.keys(module).includes("loaded"));
const { id, loaded, filename = "none" } = module;
console.log(id, loaded, typeof filename);
