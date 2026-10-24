// Exported functions that read `this`, called through a constant, through another module and through a variable that is stored again.
const lib = require("./lib");
console.log(lib.viaConst(), "|", lib.viaOther(), "|", lib.reassigned());
