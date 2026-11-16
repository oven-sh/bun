// Sloppy CommonJS that another file requires.
var ESC = "\033[";
module.exports = { red: ESC + "31m", reset: ESC + "0m", mode: 0755, bell: "\7" };
