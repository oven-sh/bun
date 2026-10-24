// `module.exports = chosen`, where `chosen` is a variable that is stored twice: the export is what it holds at that moment, and a later store to the variable exports nothing.
const chosen = require("./chosen.cjs");
console.log(chosen(), chosen.member, chosen.late);
