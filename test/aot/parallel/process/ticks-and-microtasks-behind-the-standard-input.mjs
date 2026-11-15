// As ticks-and-microtasks-behind-a-standard-stream.mjs, for process.stdin.
// STATISTIC: ImageFunctionsEmitted <= 200 Todo: what this program reaches of Bun's library is not cut down to what it uses yet
console.log(process.stdin.fd);
await 1;
queueMicrotask(() => console.log("microtask"));
process.nextTick(() => console.log("tick"));
