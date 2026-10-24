// Assorted: rb heap by name. It prints what plain Bun prints.
import { getHeapStatistics } from "node:v8";
const stats: any = getHeapStatistics();
const key = process.argv.length > 100 ? "x" : "does_zap_garbage";
console.log(stats[key], stats.does_zap_garbage, typeof stats[key]);
console.log(JSON.stringify(stats).includes('"does_zap_garbage":0'), JSON.stringify(Object.entries(stats).filter(([name]) => name.startsWith("does") || name.startsWith("number_of"))));
const typed = getHeapStatistics();
console.log(typed.does_zap_garbage, typed.does_zap_garbage === 0, typed.does_zap_garbage + 1, typed.number_of_detached_contexts);
