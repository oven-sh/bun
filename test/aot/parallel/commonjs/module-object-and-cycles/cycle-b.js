countRun("cycle-b");
exports.early = "b early";
const a = require("./cycle-a.js");
exports.partialAKeys = Object.keys(a).join();
exports.partialBKeys = a.listBKeys();
exports.readALate = () => a.late;
