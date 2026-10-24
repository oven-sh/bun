// Exported functions, arrows and classes that ignore `this`, called through the variable that holds the require.
const lib = require("./lib");
console.log(lib.f(1), lib.arrow(2), lib.g(3), lib.K.s(), new lib.K() instanceof lib.K);
