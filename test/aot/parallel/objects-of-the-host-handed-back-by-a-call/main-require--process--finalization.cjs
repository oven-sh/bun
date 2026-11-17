const held = require.main.require("node:process");
console.log(typeof held.finalization, typeof held.finalization.register);
console.log("end");
