const show = require("./show.cjs");
show("while it loads", module);
exports.showAgain = () => show("asked by itself later", module);
