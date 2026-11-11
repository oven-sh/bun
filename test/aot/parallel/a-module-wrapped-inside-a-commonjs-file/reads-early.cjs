var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var total;
function look() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return total;
}
var require_inner = __commonJS((exports, module) => {
  exports.kind = typeof look();
  exports.text = String(look());
});
console.log(require_inner().kind, require_inner().text);
total = process.argv.length + 40;
console.log(typeof look(), look() > 40);
