module.parent = 7;
console.log("only tested:", !module.parent, typeof module.parent, module.parent == null, module.parent ? "yes" : "no");
if (!module.parent) console.log("takes itself for the entry file");
