var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var total;
function first() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return total;
}
function second() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return typeof total;
}
var require_inner = __commonJS((exports, module) => { exports.kind = second(); });
console.log(require_inner().kind);
total = process.argv.length + 40;
console.log(first() > 40, second());
