const path = require("path");
function names() { return [typeof require, typeof module, typeof exports, path.basename(__filename), path.basename(__dirname).length > 0, module.exports === exports, require.main === module]; }
const viaArrow = () => [this === module.exports, typeof arguments, arguments.length, arguments[0] === exports];
class K { static where = path.basename(__filename); who() { return module.id === "." || typeof module.id; } }
exports.mark = 1;
console.log(names().join(), viaArrow().join(), K.where, new K().who(), Object.keys(module.exports).join());
