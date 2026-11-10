const made = require("node:module").createRequire(__filename);
made("./piece.cjs");
console.log("RETURNED");
throw new Error("gives up");
