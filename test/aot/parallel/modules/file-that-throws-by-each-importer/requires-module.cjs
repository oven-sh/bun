globalThis.log.push("requires-module"); exports.x = 1; const m = require("./module-imports-requirer.mjs"); globalThis.log.push(Object.keys(m).join()); throw new Error("from requires-module");
