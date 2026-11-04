var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_marks = __commonJS((exports) => {
  exports.kMark = Symbol("mark");
  exports.step = 2;
});
const marks = require_marks();
class Page { constructor(n) { this[marks.kMark] = n; } read() { return this[marks.kMark] + marks.step; } }
let sum = 0;
for (let i = 0; i < 300; i++) sum += new Page(i).read();
console.log(sum, typeof marks.kMark);
