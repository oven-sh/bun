// process.exit() in a branch before a write to a locked built-in: the build warns instead of failing.
if (Array.prototype.at) {
  console.log("native");
  process.exit(0);
}
Array.prototype.at = function () {
  return "polyfilled";
};
console.log("never");
