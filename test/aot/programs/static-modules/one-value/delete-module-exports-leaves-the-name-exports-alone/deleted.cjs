exports.a = 1;
const was = delete module.exports;
exports.b = [was, typeof module.exports].join();
globalThis.seen = exports;
exports.c = typeof this.a;
