// A function of the library answers a literal with seventeen members, of which the program reads three. A validating build must not stop: the fields that nobody reads are removed, and whoever checks what the members hold must not look for them.
// Flags: --aot-validate
import { getHeapStatistics } from "node:v8";
console.log(typeof getHeapStatistics().used_heap_size);
const stats = getHeapStatistics();
console.log(stats.does_zap_garbage, typeof stats.does_zap_garbage, stats.number_of_detached_contexts);
