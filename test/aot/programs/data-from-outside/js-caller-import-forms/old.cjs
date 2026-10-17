const typed = require("./typedF.ts");
module.exports = function () { try { return typed.one({ id: 1, name: "given" }); } catch (error) { return "THROWS " + String(error).split(" (bun")[0]; } };
