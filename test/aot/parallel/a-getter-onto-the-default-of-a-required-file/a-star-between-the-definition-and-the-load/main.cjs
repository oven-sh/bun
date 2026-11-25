let said;
try { const barrel = require("./barrel.cjs"); said = barrel.add + " " + barrel.more; } catch (error) { said = error.constructor.name; }
console.log(said);
