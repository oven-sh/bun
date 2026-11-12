var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
function readLimit() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return limit + work;
}
function readTable() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return table.alpha + work;
}
function makeBox() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return new Box(3).size + work;
}
function ask(read) {
  try { return String(read()); } catch (error) { return error.name; }
}
var require_inner = __commonJS((exports, module) => {
  exports.limit = ask(readLimit);
  exports.table = ask(readTable);
  exports.box = ask(makeBox);
});
console.log(require_inner().limit);
console.log(require_inner().table);
console.log(require_inner().box);
let limit = process.argv.length + 5;
const table = { alpha: 1 };
class Box { constructor(size) { this.size = size; } }
console.log(readLimit() > 5, readTable(), makeBox());
