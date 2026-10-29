// Getters the program defines on process run while node:process loads through a computed specifier, not at the first read of the export. Bun's own getters are still read on demand. The last line differs from plain Bun (.expected.txt): it reads process.stdout off a module that is loaded under a computed name, such a load finds what is in the executable and keeps nothing, and nothing else in the program uses process.stdout: Object.defineProperty stores under its key and reads no member of process. The read answers the function that stands for a member that was left out.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
Object.defineProperty(process, "custom", {
  get() {
    console.log("read");
    return 1;
  },
  enumerable: true,
  configurable: true,
});
const readArrow = () => {
  console.log("read arrow");
  return 2;
};
Object.defineProperty(process, "customArrow", { get: readArrow, enumerable: true, configurable: true });
function readBound(value: number) {
  console.log("read bound");
  return value;
}
Object.defineProperty(process, "customBound", { get: readBound.bind(null, 3), enumerable: true, configurable: true });

console.log("before");
const loaded = await import("node:" + ["process"][0]);
console.log("loaded");
console.log("after", loaded.custom, loaded.custom);
console.log("after", loaded.customArrow, loaded.customBound);
console.log(typeof loaded.stdout, typeof loaded.title);

export {};
/* Output:
before
read
read arrow
read bound
loaded
after 1 1
after 2 3
function string
*/
