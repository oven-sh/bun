// The lines are those of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and on a busy machine some of its runs print another order.
const line = [];
globalThis.say = word => line.push(word);
globalThis.keep = call => { call.catch(() => {}); return call; };
const first = keep(import("./pages.mjs"));
try { await import("./menu.mjs"); say("menu+"); await first; say("pages+"); } catch (error) { say("threw " + error.name); }
console.log(line.join(" "));
/* Output:
pages< pages= layout menu:F menu+ pages> pages+
*/
