exports.name = "second";
exports.same = this === exports && module.exports === exports;
exports.read = () => exports.name;
exports.keysOfFirst = Object.keys(require("./" + ["first"][0] + ".cjs")).join();
