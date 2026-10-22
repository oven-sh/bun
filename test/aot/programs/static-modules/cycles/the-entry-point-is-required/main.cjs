// A module requires the entry point, whose body is running: it gets the exports of the entry point as far as they have got, and the body does not start again.
exports.early = "early";
const a = require("./a.cjs");
exports.late = "late";
console.log(a.sawEarly, a.sawLate, a.readLate(), a.isSame(module.exports), require.main === module);
