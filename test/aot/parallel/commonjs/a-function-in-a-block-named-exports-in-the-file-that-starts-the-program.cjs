// `exports` is a parameter of the function that holds the text of the file, so the function in the block stays in its block.
exports.a = 1; { function exports() {} } console.log(typeof exports, Object.keys(exports).join());
