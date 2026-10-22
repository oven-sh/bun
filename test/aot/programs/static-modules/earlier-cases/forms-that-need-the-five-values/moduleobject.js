exports.a = 1;
exports.m = typeof module.id + ":" + (module.exports === exports) + ":" + Object.keys(module).includes("exports");
