// A getter that reads a member of `var m = require(..)` throws when the declaration was never reached.
try { console.log(require("./lib").a); } catch (e) { console.log(e.constructor.name); }
