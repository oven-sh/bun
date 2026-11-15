const held = require.main.require("node:process");
console.log(typeof held[JSON.parse('"finalization"')]);
console.log("end");
