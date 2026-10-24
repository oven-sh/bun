// What built ins make: programs l reduce right. It prints what plain Bun prints.
// @ts-nocheck
if (process.argv.length > 99) {
  [1].reduceRight((a, b) => a + b, 0);
}
console.log("hello");
