// Bun main is awaited at the top level of the entry point.
const clock = setTimeout(() => {
  console.log("still pending");
  process.exit(0);
}, 3000);
console.log("the entry point runs");
const main = await import("bun:main");
clearTimeout(clock);
console.log("loaded", typeof main, Object.keys(main).length);
/* Output:
the entry point runs
loaded object 0
*/
