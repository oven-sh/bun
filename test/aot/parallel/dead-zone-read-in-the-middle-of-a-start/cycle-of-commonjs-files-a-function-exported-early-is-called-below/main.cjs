exports.read = function () { try { return late.rate; } catch (error) { return error.name; } };
require("./below.cjs");
const late = { rate: 0.2 };
console.log("main", exports.read());
