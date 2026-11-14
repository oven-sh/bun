// The line is that of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and some of its runs print another order.
const line = [];
globalThis.say = word => line.push(word);
(async () => {
  const pages = import("./pages.mjs");
  await import("./layout.mjs");
  line.push("layout+");
  await pages;
  line.push("pages+");
  console.log(line.join(" "));
})();
/* Output:
layout menu pages layout+ pages+
*/
