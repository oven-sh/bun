// `process.mainModule` held as a value, in the entry point and in a file that it requires.
const main = process.mainModule;
console.log(main === module, main === require.main, main.id, main.filename === __filename);
exports.answer = 42;
console.log(main.exports === exports, main.exports.answer, typeof main.require);
require("./other.cjs").show();
