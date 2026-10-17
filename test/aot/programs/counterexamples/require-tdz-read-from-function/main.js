// A function that reads a top-level `const m = require(..)` above the declaration throws a ReferenceError.
function g() { return m; }
{ const m = require("./main"); }
try { console.log(typeof g()); } catch (e) { console.log(e.constructor.name); }
const m = require("./main");
