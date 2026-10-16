// A parameter m is itself again behind a block that declares `const m = require(..)`.
function g(m) { { const m = require("./a"); } return m; }
console.log(g("parameter"));
