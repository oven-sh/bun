// Names that are stored and never read do not keep what they hold alive, and a read through another name still finds it.
const lib = require("./lib");
console.log(lib.direct, lib.maker()(), lib.viaB);
