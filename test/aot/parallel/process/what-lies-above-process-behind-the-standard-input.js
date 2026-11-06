// As what-lies-above-process-behind-a-standard-stream.js, for process.stdin.
// STATISTIC: ImageFunctionsEmitted <= 130
console.log(process.stdin.fd);
let depth = 0;
for (let object = process; object !== null; object = Object.getPrototypeOf(object)) depth++;
console.log(depth, typeof process._eventsCount);
