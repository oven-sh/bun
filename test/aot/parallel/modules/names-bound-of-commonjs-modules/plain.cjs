exports.one = "one of plain";
exports.default = "default of plain";
Object.defineProperty(exports, "hidden", { value: "hidden of plain", enumerable: false, writable: true, configurable: true });
exports.change = function () { exports.one = "one of plain, stored later"; return exports; };
