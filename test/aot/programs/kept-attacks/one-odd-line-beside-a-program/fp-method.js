// One odd line that never runs stands beside a program that does not change: fp method. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  count.prototype.more = function () { return this; }; new count(world[0]).more();
}
console.log(summary(run(world, options)));
