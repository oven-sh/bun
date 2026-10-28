// One odd line that never runs stands beside a program that does not change: proxy read. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  console.log(new Proxy(world[0], {}).hits);
}
console.log(summary(run(world, options)));
