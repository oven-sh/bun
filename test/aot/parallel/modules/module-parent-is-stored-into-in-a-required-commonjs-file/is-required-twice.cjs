const show = require("./show.cjs");
module.parent = false;
exports.showAgain = () => show("required twice", module);
exports.showAgain();
