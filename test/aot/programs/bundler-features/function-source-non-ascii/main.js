function greet() { return "é"; }
console.log(String(greet).includes("[native code]"), String(greet).includes("return"), greet());
// bun --aot: this file is not UTF-8: read as the runtime reads it