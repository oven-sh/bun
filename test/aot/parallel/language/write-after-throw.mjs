// A called function throws before a write to a locked built-in, and an uncaughtException listener handles it.
process.on("uncaughtException", error => {
  console.log("caught", error.message);
});
function check(value) {
  if (value.length < 99) throw new Error("early");
}
check(process.argv);
Array.prototype.push = function () {};
