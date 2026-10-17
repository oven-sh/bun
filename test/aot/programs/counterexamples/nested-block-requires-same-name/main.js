// `const m = require(..)` in an inner block shadows the `m` of the block around it.
{ let m = { x: "outer" }; { const m = require("./a"); console.log(m.x); } }
