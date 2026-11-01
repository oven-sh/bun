// process.exit() two calls deep before a write to a locked built-in.
function leave(code) {
  process.exit(code);
}
function report(text) {
  console.log(text);
  leave(0);
}
report("done");
Array.prototype.push = function () {};
