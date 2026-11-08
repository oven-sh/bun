// What TypeScript makes of an ES module: the mark is defined on the exports, and names are stored there. None of them is a name that Bun looks for. With Bun.serve in use the timer alone brought in 380 functions of the library.
// STATISTIC: ImageFunctionsEmitted <= 8
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.twice = void 0;
function twice(n) {
  return n * 2;
}
exports.twice = twice;
setTimeout(() => console.log(twice(21), Object.keys(exports).join()), 1);
