// Assorted: rb heap statistics. It prints what plain Bun prints.
const v8 = require("node:v8");
const stats = v8.getHeapStatistics();
console.log(stats.does_zap_garbage === 0, typeof stats.does_zap_garbage, stats.does_zap_garbage ? "zaps" : "does not zap");
if (stats.does_zap_garbage) console.log("zaps");
else console.log("no");
for (const key of Object.keys(stats)) console.log(key, typeof stats[key]);
console.log(stats.number_of_detached_contexts === 0, stats.total_global_handles_size === 8192, stats.used_global_handles_size);
