// One odd line that never runs stands beside a program that does not change: then number. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  Promise.resolve(1).then(x => x);
}
console.log(summary(run(world, options)));
