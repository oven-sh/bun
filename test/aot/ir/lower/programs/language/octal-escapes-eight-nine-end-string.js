// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1487 14

// Octal escapes of one or two digits with an 8, a 9 or the end of the string behind them: `bun run` reports each and runs nothing, and so does the build.
console.log("never printed");
console.log("\1".length);
console.log('\2'.length);
console.log("a\03".length);
console.log("\00".length);
console.log("-42\4967297".length);
console.log("\058".length);
console.log("\08".length === "\09".length);
console.log("\678".length);
console.log({ "\7": 1 });
class Named {
  "\10"() {}
}
function neverCalled() {
  "\11";
  return "\12";
}
if (false) console.log("\13");
