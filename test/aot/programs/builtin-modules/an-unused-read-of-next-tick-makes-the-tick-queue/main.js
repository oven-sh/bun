// The first read of process.nextTick makes the tick queue, and whether the queue is there decides whether the first tick of a module that is imported later runs before or behind a promise job.
// Nobody uses what is read here, and the read stays.
process.nextTick;
console.log((await (await import("./first.js")).order).join(", "));
