// As tsc prints it for CommonJS: the object lies in the variable and on exports, and whoever requires the file changes it.
const marks_1 = require("./marks.cjs");
function kind(c) { return c === marks_1.Marks.End ? "end" : c === marks_1.Marks.Tab ? "tab" : "other"; }
console.log(kind(-1), kind(9), kind(4), marks_1.own(-1), marks_1.own(9), Object.keys(marks_1.Marks).join());
for (let i = 0; i < 3000; i++) kind(i & 15), marks_1.own(i & 15);
marks_1.Marks.Tab = 4;
console.log(kind(-1), kind(9), kind(4), marks_1.own(9), marks_1.own(4));
marks_1.Marks = { End: 4, Tab: -1 };
console.log(kind(-1), kind(4), marks_1.own(-1), marks_1.own(4));
