// @bun @bun-cjs
// The entry point is a bundle in the commonjs format of bun build.
(function(exports, require, module, __filename, __dirname) {console.log("the body runs", typeof require, typeof module, exports === module.exports);
exports.a = 1;
})
