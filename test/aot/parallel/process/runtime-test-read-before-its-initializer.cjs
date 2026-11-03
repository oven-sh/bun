// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
var viaEarlyObject = { early };
console.log(early(), viaEarlyObject.early());
var isBun = typeof Bun === "object";
function early() {
  return isBun ? "bun" : "not yet";
}
var viaObject = { early };
console.log(early(), viaObject.early());
if (process.argv.length > 9) {
  var never = typeof Bun === "object";
}
function late() {
  return never ? "bun" : "never";
}
console.log(late());
var twice = typeof Bun === "object";
function both() {
  return twice ? "bun" : "other";
}
console.log(both());
twice = false;
console.log(both());
