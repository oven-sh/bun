// process.env is a Proxy of the program, and its trap throws once while node:test loads: what the next require of the module does.
// Plain Bun runs the body of the module again. An executable runs it once and keeps what it threw, as for a file of the program.
const real = process.env;
let reads = 0;
process.env = new Proxy(real, {
  get(target, key) {
    if (++reads === 2) throw new Error("thrown at read " + reads);
    return target[key];
  },
});
for (const round of [1, 2, 3]) {
  try {
    console.log(round, typeof require("node:test"));
  } catch (error) {
    console.log(round, error.message);
  }
}
process.env = real;
console.log(typeof require("node:path").join, typeof require("node:util").inspect);
/* Output:
1 thrown at read 2
2 thrown at read 2
3 thrown at read 2
function function
*/
