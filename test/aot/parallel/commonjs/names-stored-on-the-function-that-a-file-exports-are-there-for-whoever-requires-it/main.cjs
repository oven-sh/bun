// `module.exports = f, module.exports.marker = true, module.exports.default = module.exports`: what every helper of a compiler's run-time package ends with.
// Whoever requires the file finds the names, so the holder is the function itself.
"use strict";
function pick(e) {
  return e && e.marker ? e : { default: e };
}

const first = pick(require("./at-the-head.cjs"));
const second = pick(require("./behind-a-require.cjs"));
const third = pick(require("./unmarked.cjs"));
function turn(i) {
  return (0, first.default)(i) + (0, second.default)(i) + (0, third.default)(i);
}
let sum = 0;
for (let i = 0; i < 1000; i++) sum += turn(i & 7);
console.log(sum, typeof first, typeof second, typeof third, first.default === first, second.default === second, third.default === third);
console.log(Object.keys(first).join(), Object.keys(second).join(), Object.keys(third).join());
