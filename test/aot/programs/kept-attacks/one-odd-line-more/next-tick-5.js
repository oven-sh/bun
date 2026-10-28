// One odd line that never runs stands beside a program that does not change: next tick. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  process.nextTick((a, b, c, d, e) => a.hits + e.hits, world[0], world[1], world[2], world[3], world[4]);
}
console.log(summary(run(world, options)));
