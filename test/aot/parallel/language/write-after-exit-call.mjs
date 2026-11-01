// process.exit invoked through Function.prototype.call before a write to a locked built-in.
console.log("done");
process.exit.call(process, 0);
Array.prototype.push = function () {};
