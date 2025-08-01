import { bench, run } from "../runner.mjs";

function doIt(...args) {
  // we use .at() to prevent constant folding optimizations
  return args.slice().at(0);
}

bench("Array.prototype.slice.call(arguments)", () => {
  return doIt(1, 2, 3, 4, 5, 6);
});

await run();
