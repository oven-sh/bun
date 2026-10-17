// A top-level `const m = require(..)` has its dead zone even though a block above binds the same name.
{ const m = require("./a"); }
try { console.log(m.x); } catch (e) { console.log(e.name); }
const m = require("./a");
