exports.a = 1;
exports.f = function () { return this === exports ? "the exports" : typeof this; };
Object.defineProperty(exports, "hidden", { value: "not enumerable" });
