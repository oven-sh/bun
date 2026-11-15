// The line is that of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and some of its runs print another order, or a ReferenceError.
const ran = [], settled = [];
globalThis.say = word => ran.push(word);
const note = (name, call) => call.then(() => settled.push(name + "+"), error => settled.push(name + "!" + error.name));
(async () => {
  const first = note("pages", import("./pages.mjs"));
  await 0; await 0; await 0; await 0; await 0;
  const second = note("menu", import("./menu.mjs"));
  await Promise.all([first, second]);
  console.log("ran: " + ran.join(" "));
  console.log("settled: " + settled.join(" "));
})();
/* Output:
ran: layout theme:F pages:T menu:T
settled: pages+ menu+
*/
