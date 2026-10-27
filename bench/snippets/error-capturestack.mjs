import vm from "node:vm";
import { bench, run } from "../runner.mjs";

var err = new Error();
bench("Error.captureStackTrace(err)", () => {
  Error.captureStackTrace(err);
});

bench("Error.prototype.stack", () => {
  new Error().stack;
});

const cases = `(function () {
  function recurse(depth, leaf) {
    return (depth === 0 ? leaf() : recurse(depth - 1, leaf)) || null;
  }
  const capture = () => Error.captureStackTrace({});
  const withCallerFramesDown = depth => {
    const caller = () => recurse(depth, () => Error.captureStackTrace({}, caller));
    return caller;
  };
  return {
    "Error.captureStackTrace({})": capture,
    "Error.captureStackTrace({}, caller), caller 3 frames down": withCallerFramesDown(3),
    "Error.captureStackTrace({}, caller), caller 20 frames down": withCallerFramesDown(20),
    "Error.captureStackTrace({}), 1000 frames deep": () => recurse(1000, capture),
  };
})()`;
for (const [realm, evaluate] of [
  ["", code => (0, eval)(code)],
  [" in a node:vm context", code => vm.runInNewContext(code)],
]) {
  for (const [name, fn] of Object.entries(evaluate(cases))) bench(name + realm, fn);
}

await run();
