// A using declaration whose disposal throws at the end of the body.
let m;
try { m = require("./m.cjs"); } catch (e) { console.log("caught", e.message); }
console.log(typeof m);
try { m = require("./m.cjs"); console.log("second", m.a, m.b); } catch (e) { console.log("caught again", e.message); }
