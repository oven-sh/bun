// The line is that of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and some of its runs print another order, or three ReferenceErrors.
// In which order the three settle is not the same in the two: the names are sorted.
const ran = [], settled = [];
globalThis.say = word => ran.push(word);
const note = (name, call) => call.then(() => settled.push(name + "+"), error => settled.push(name + "!" + error.name));
Promise.all([note("site", import("./site.mjs")), note("pages", import("./pages.mjs")), note("layout", import("./layout.mjs"))]).then(() => {
  console.log("ran: " + ran.join(" "));
  console.log("settled: " + settled.sort().join(" "));
});
/* Output:
ran: layout pages:F site
settled: layout+ pages+ site+
*/
