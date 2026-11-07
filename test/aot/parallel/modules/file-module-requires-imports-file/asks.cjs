console.log("asks: parent", typeof module.parent, module.parent && module.parent.id);
if (!module.parent) console.log("asks: nobody required me, so I am the program");
module.parent.exports.put = "read from the parent: " + module.parent.exports.mine;
require("./imports-asks.mjs");
console.log("asks: children", module.children.length);
