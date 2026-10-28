let a; try { a = require("./a.mjs"); exports.seen = Object.keys(a).join() + "|" + typeof a.x; } catch (e) { exports.seen = e.name; }
