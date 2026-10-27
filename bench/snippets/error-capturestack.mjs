import vm from "node:vm";
import { bench, run } from "../runner.mjs";

var err = new Error();
bench("Error.captureStackTrace(err)", () => {
  Error.captureStackTrace(err);
});

bench("Error.captureStackTrace(plain object)", () => {
  Error.captureStackTrace({});
});

bench("Error.prototype.stack", () => {
  new Error().stack;
});

const stackInContext = vm.runInNewContext("() => new Error().stack");
bench("Error.prototype.stack in a node:vm context", () => {
  stackInContext();
});

// From here on Error.prepareStackTrace is not the property that nothing has written.
bench("Error.prototype.stack, Error.prepareStackTrace assigned and restored", function* () {
  const original = Error.prepareStackTrace;
  Error.prepareStackTrace = () => "";
  Error.prepareStackTrace = original;
  yield () => {
    new Error().stack;
  };
});

bench("Error.prototype.stack, Error.prepareStackTrace is a function", function* () {
  const original = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, callSites) => callSites.length;
  yield () => {
    new Error().stack;
  };
  Error.prepareStackTrace = original;
});

await run();
