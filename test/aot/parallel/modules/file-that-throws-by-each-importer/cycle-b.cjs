globalThis.log.push("cycle-b"); exports.b = 1; try { require("./cycle-a.mjs"); } catch (error) { globalThis.log.push("inner:" + error.message); } throw new Error("from cycle-b");
