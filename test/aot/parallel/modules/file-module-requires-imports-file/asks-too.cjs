console.log("asks-too: parent", typeof module.parent, module.parent && require("node:path").basename(module.parent.filename), module.parent.parent.id);
require("./imports-asks-too.mjs");
