// Reading an undeclared global throws a ReferenceError before a write to a locked built-in.
process.on("uncaughtException", error => {
  console.log("caught", error.name);
});
console.log(typeof undeclaredName);
if (process.argv.length < 99) console.log(undeclaredName);
Array.prototype.push = function () {};
