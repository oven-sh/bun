// One odd line that never runs stands beside a program that does not change: hook reads. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  require("node:async_hooks").createHook({ init(a, b, c, r) { r.args[0].hits = "x"; r.callback(world[1]); } }).enable(); process.nextTick(b => b.hits, world[0]);
}
console.log(summary(run(world, options)));
