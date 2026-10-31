const first = module.parent;
module.parent = module;
console.log(module.parent === module, module.parent === first);
module.parent = first;
console.log(module.parent === first);
module.parent = "text";
console.log(module.parent);
