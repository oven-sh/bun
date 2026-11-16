module.parent = 7;
console.log(typeof module.parent, !module.parent);
if (!module.parent) console.log("no parent");
