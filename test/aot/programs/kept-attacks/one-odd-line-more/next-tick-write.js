// One odd line that never runs stands beside a program that does not change: next tick write. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  process.nextTick(b => { b.hits = 7; }, world[0]);
}
console.log(summary(run(world, options)));
