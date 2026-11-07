// The line is that of Node.js, `bun build --compile` and `bun <file>`.
const line = [], pending = [];
globalThis.say = word => line.push(word);
globalThis.keep = call => pending.push(call);
await import("./site.mjs");
say("site+");
await Promise.all(pending);
console.log(line.join(" "));
/* Output:
starts< starts> layout pages:F site site+
*/
