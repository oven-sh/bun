const time = process.hrtime();
console.log(time.length, typeof time[0], typeof time[1], typeof process.hrtime.bigint());
const memory = process.memoryUsage();
console.log(typeof memory.rss, typeof memory.heapUsed, typeof process.memoryUsage.rss(), typeof process.cpuUsage().user);
