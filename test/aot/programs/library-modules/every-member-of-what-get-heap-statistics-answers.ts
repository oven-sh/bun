// node:v8's getHeapStatistics(): every member read by its name, by a computed name, through Object.entries and JSON.stringify; the members that are constants in the library are what plain Bun answers.
import { getHeapStatistics } from "node:v8";
const stats: any = getHeapStatistics();
const key = process.argv.length > 100 ? "x" : "does_zap_garbage";
console.log(stats[key], stats.does_zap_garbage, typeof stats[key]);
console.log(JSON.stringify(stats).includes('"does_zap_garbage":0'), JSON.stringify(Object.entries(stats).filter(([name]) => name.startsWith("does") || name.endsWith("contexts") || name.endsWith("handles_size"))));
const typed = getHeapStatistics();
console.log(typed.does_zap_garbage, typed.does_zap_garbage === 0, typed.does_zap_garbage + 1, typed.number_of_detached_contexts, typed.total_global_handles_size === 8192, typed.used_global_handles_size);
console.log(Object.keys(typed).sort().join(), Object.values(typed).every(value => typeof value === "number"));
if (typed.does_zap_garbage) console.log("zaps");
else console.log("does not zap");
