const held = require.main.require("node:process");
console.log(typeof held.allowedNodeEnvironmentFlags, held.allowedNodeEnvironmentFlags.has("--made-up"));
console.log("end");
