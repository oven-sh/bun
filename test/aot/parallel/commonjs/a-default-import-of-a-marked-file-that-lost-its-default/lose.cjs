delete require("./written.cjs").default;
const computed = require("./computed.cjs");
delete computed[process.argv.length > 90 ? "list" : "default"];
require("./kept.cjs").default = "stored";
