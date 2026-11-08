// As what-lies-above-process-behind-a-standard-stream.js, for process.stdin.
// STATISTIC: ImageFunctionsEmitted <= 130 Todo: what this program reaches of Bun's library is not cut down to what it uses yet
console.log(process.stdin.fd);
let depth = 0;
for (let object = process; object !== null; object = Object.getPrototypeOf(object)) depth++;
console.log(depth, typeof process._eventsCount);
