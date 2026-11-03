// collection-lookups-in-loops.ts in a build that checks itself while it runs: a lookup that left its loop is made again in each iteration and compared.
// Flags: --aot-validate
import "./collection-lookups-in-loops.ts";
