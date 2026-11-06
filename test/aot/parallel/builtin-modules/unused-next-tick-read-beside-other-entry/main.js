// The first read of process.nextTick creates the tick queue, which decides whether the first tick of a module imported later runs before or after a promise job.
// The other entry points start with the same statement as the one after the read.
// Entry points: ./stores-a-global.js ./prints-1.js ./prints-2.js ./prints-3.js ./prints-4.js
process.nextTick;
console.log((await (await import("./first.js")).order).join(", "));
