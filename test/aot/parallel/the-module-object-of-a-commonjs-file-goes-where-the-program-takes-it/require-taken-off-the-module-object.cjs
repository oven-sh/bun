const load = module.require;
console.log(typeof load.call(module, "node:path").join);
