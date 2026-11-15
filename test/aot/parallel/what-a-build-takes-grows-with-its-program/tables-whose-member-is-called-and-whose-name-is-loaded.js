// SIZE lines of one file each write a table, call a member of it and load the module that it names. Whether the called member can change its table is asked of the places
// where the file says `this` or `super`. Listed anew for every load, 1,000 | 2,000 | 4,000 lines took 2.77 | 4.09 | 8.33 G instructions.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 1000 2000 4000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 8),
  copies = Number(process.env.PASSES ?? 1);
const out = ["let sum = 0;"];
for (let copy = 0; copy < copies; copy++) {
  out.push(`function run${copy}() {`);
  for (let at = 0; at < size; at++) {
    out.push(`  const table${at} = { name: "node:path", one() { return 1; } };`);
    out.push(`  sum += table${at}.one() + require(table${at}.name).sep.length;`);
  }
  out.push("}", `run${copy}();`);
}
out.push("console.log(sum);");
console.log(out.join("\n"));
