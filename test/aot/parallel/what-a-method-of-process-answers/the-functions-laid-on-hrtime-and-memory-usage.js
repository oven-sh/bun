// Native code lays `bigint` on process.hrtime and `rss` on process.memoryUsage. Neither function has another member of its own.
const first = process.hrtime.bigint();
const second = process.hrtime.bigint();
console.log(typeof first, second >= first, first > 0n);
console.log(typeof process.memoryUsage.rss(), process.memoryUsage.rss() > 0);
console.log(Object.keys(process.hrtime).join(), Object.keys(process.memoryUsage).join());
console.log(process.hrtime.made, process.memoryUsage.made);
const { bigint } = process.hrtime;
const { rss } = process.memoryUsage;
console.log(typeof bigint.call(undefined), typeof rss.call(null), typeof bigint.apply({}, [1, 2]));
console.log(bigint.name, bigint.length, rss.name, rss.length);
console.log(
  typeof process.hrtime.call,
  typeof process.memoryUsage.bind,
  process.hrtime.name,
  process.memoryUsage.length,
);
