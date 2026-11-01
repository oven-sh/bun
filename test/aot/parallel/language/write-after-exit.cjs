// process.exit() directly before three kinds of write to a locked built-in, in a CommonJS file.
console.log("done");
process.exit(0);
Array.prototype.push = function () {};
Object.defineProperty(Array.prototype, "pop", { value() {} });
delete Array.prototype.shift;
