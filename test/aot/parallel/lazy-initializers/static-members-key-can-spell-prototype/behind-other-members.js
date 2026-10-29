const key = "prototype";
const other = "other";
function filler() {
  return { a: 1 };
}
const held = [class { first() {} static [other]() {} static [key]() {} static last() {} }, filler()];
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
