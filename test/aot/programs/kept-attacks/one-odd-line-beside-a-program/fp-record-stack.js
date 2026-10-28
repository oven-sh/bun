// One odd line that never runs stands beside a program that does not change: fp record stack. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  Error.captureStackTrace({ a: 1 });
}
console.log(summary(run(world, options)));
