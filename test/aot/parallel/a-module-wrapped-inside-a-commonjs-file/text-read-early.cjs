var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var label;
function width() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return label.length;
}
var require_inner = __commonJS((exports, module) => {
  try { exports.out = String(width()); } catch (error) { exports.out = error.name; }
});
console.log(require_inner().out);
label = "ab".repeat(process.argv.length);
console.log(width() > 0);
