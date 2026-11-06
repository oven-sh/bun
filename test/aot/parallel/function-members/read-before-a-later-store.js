function late() {
  return late.value;
}
console.log(late(), "value" in late);
late.value = 1;
console.log(late());
function run() {
  return early.value;
}
console.log(run());
function early() {}
if (process.argv.length > 100) early.value = 1;
console.log(early.value, Object.keys(early));
