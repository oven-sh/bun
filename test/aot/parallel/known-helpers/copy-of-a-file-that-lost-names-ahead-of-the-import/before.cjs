const names = require("./names.cjs");
delete names.sep;
delete names.basename;
const whole = require("./whole.cjs");
delete whole.sep;
delete whole.basename;
delete require("./marked.cjs").sep;
