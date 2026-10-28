// One odd line that never runs stands beside a program that does not change: fp class stack. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  Error.captureStackTrace(new Vec(1, 2));
}
console.log(summary(run(world, options)));
