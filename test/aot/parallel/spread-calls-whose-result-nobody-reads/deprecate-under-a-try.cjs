const util = require("node:util"); for (const bad of [[() => {}, "m", 5], [() => {}, 5]]) { try { util.deprecate(...bad); console.log("ok"); } catch (e) { console.log(e.code); } }
