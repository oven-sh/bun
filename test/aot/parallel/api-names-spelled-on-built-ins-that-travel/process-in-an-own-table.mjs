const table = { first: process };
const k = process.argv.length > 99 ? "none" : ["fir", "st"].join("");
console.log(table[k].kill(table[k].pid, 0), typeof table[k].memoryUsage().rss, typeof table[k].hrtime.bigint());
