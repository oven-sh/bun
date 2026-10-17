// A block-scoped `exports` taken out of another module is not the file's own exports object.
exports.x = "own";
{ const { exports } = require("./a"); console.log(exports.x); }
