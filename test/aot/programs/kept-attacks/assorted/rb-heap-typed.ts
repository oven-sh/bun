// Assorted: rb heap typed. It prints what plain Bun prints.
import { getHeapStatistics } from "node:v8";
console.log(typeof getHeapStatistics().used_heap_size);
const stats = getHeapStatistics();
console.log(stats.does_zap_garbage, typeof stats.does_zap_garbage, stats.number_of_detached_contexts);
