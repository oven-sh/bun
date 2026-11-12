// The lines are those of `bun <file>` and Node.js: a module that imports into a cycle that has failed fails with it. `bun build --compile` runs menu.mjs all the same.
const ran = [], settled = [], calls = [];
globalThis.say = word => ran.push(word);
const note = (name, call) => calls.push(call.then(() => settled.push(name + "+"), () => settled.push(name + "!")));
note("pages", import("./pages.mjs"));
await null; await null; await null;
note("menu", import("./menu.mjs"));
await null;
note("alone", import("./alone.mjs"));
await Promise.all(calls);
console.log("ran: " + ran.sort().join(" "));
console.log("settled: " + settled.sort().join(" "));
/* Output:
ran: alone layout pages
settled: alone+ menu! pages!
*/
