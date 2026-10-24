// The fields of a module object are defined anew or stored through another name.
Object.defineProperty(module, "id", { get() { return "from a getter"; } });
Object.defineProperty(module, "loaded", { value: 7 });
console.log(module.id, module.loaded);
const m = module;
m.filename = "through another name";
console.log(module.filename);
