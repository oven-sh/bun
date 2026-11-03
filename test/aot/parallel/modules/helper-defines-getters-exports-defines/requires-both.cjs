const withDefault = require("./with-default.cjs");
const withoutDefault = require("./without-default.cjs");
console.log(withDefault.__esModule, withDefault.default, withDefault.number);
console.log(withoutDefault.__esModule, withoutDefault.default, withoutDefault.number);
