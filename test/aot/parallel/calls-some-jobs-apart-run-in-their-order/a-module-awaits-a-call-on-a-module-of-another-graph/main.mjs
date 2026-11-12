// The lines are those of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and on a busy machine some of its runs print another order.
const line = [];
globalThis.say = word => line.push(word);
globalThis.keep = call => { call.catch(() => {}); return call; };
const first = keep(import("./pages.mjs")), second = keep(import("./menu.mjs"));
first.then(() => say("pages+"), error => say("pages!" + error.name));
second.then(() => say("menu+"), error => say("menu!" + error.name));
await Promise.allSettled([first, second]);
console.log(line.join(" "));
/* Output:
menu< layout pages pages+ menu> menu+
*/
