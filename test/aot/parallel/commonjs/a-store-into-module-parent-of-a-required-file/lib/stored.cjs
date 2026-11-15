console.log(typeof module.parent);
module.parent = 7;
console.log(typeof module.parent, module.parent === 7);
module.parent = { mine: 1 };
console.log(typeof module.parent, module.parent?.mine);
module.parent = undefined;
console.log(typeof module.parent);
module.parent = null;
console.log(module.parent);
