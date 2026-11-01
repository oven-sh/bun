// Flags: --aot-validate
const other = {};
process.emit.call(other, "x");
console.log(typeof other._events);
