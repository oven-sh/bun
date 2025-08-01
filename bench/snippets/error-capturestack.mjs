import { bench, run } from "../runner.mjs";

var err = new Error();
bench("Error.captureStackTrace(err)", () => {
  Error.captureStackTrace(err);
});

bench("Error.prototype.stack", () => {
  new Error().stack;
});

await run();
