// A throw inside try/finally propagates before a write to a locked built-in.
process.on("uncaughtException", error => {
  console.log("caught", error.message);
});
try {
  if (process.argv.length < 99) throw new Error("early");
} finally {
  console.log("cleaned up");
}
Array.prototype.push = function () {};
