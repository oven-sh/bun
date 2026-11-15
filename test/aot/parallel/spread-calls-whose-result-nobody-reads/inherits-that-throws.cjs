const util = require("node:util"); for (const bad of [[5, 6]]) { try { util.inherits(...bad); } catch (e) { console.log(e.code); } }
