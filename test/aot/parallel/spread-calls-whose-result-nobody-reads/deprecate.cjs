const util = require("node:util"); for (const bad of [[() => {}, "m"], [() => {}, "n"]]) { util.deprecate(...bad); console.log("ok"); }
