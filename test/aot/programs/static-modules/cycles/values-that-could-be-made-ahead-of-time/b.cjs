const a = require("./a.cjs");
exports.types = () => [typeof a.number, typeof a.string, typeof a.literal, typeof a.list, typeof a.plain, typeof a.Class].join(" ");
