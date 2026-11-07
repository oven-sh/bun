// The program puts new names on built-in objects that it holds as values nobody can follow: out of evaluated text, or back from native code. The run time refuses no new name,
// so compiled code that reads the name off the built-in finds what was put there.
// Flags: --aot-validate
const glue = (first, second) => [first, second].join(process.argv.length > 99 ? "x" : "");
const evaluate = text => new Function(glue(text, ""))();
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
function twice(read) {
  let sum = 0;
  for (let round = 0; round < 2; round++) sum += read();
  return sum;
}
evaluate("return []").constructor.extra = 5;
console.log("a constructor, through an instance:", Array.extra, twice(() => Array.extra));
const set = evaluate("return new Set()");
Object.getPrototypeOf(set).extra = 6;
console.log("a prototype:", new Set().extra, twice(() => new Set().extra));
Object.getPrototypeOf(set)[glue("ex", "tra2")] = 7;
console.log("a prototype, under a computed key:", new Set().extra2, twice(() => new Set().extra2));
unknown(Math).extra = 8;
console.log("a namespace:", Math.extra, twice(() => Math.extra));
unknown(Error.prototype).code = 9;
console.log("Error.prototype:", new RangeError("r").code, twice(() => new RangeError("r").code));
unknown(Array.prototype).last = 10;
console.log("Array.prototype:", [].last, twice(() => [].last));
unknown(String.prototype).red = 11;
console.log("String.prototype:", "s".red, twice(() => "s".red));
