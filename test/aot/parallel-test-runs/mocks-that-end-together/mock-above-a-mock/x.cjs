const { size } = require("./n.ts");
let count = 0;
exports.load = () => ++count + size();
