// Custom inspect method defined by a descriptor.
const printed = {};
Object.defineProperty(printed, Symbol.for("nodejs.util.inspect.custom"), { value() { return "defined by a descriptor"; }, enumerable: false });
console.log(printed);
console.log(Bun.inspect(printed));
