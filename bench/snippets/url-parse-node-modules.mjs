// url.parse() from a package in node_modules looks for its caller on each call,
// until a call from application code emits DEP0169.
import url from "node:url";
import { runInThisContext } from "node:vm";
import { bench, run } from "../runner.mjs";

const lib = runInThisContext(
  `(url => ({
    parse: input => url.parse(input).href.length,
    map: input => [input].map(url.parse).length,
    deep: function deep(depth, input) {
      return depth === 0 ? url.parse(input).href.length : deep(depth - 1, input) + 1;
    },
    noop: function noop(depth, input) {
      return depth === 0 ? input.length : noop(depth - 1, input) + 1;
    },
  }))`,
  { filename: "/app/node_modules/lib/index.js" },
)(url);

const input = "http://example.com/a?b=c";
let warnings = 0;
process.on("warning", () => warnings++);
lib.parse(input);
await new Promise(resolve => setImmediate(resolve));
if (warnings !== 0) throw new Error("url.parse() from the package emitted DEP0169");

bench("url.parse() from node_modules", () => lib.parse(input));
bench("100 frames", () => lib.noop(100, input));
bench("url.parse() from node_modules under 100 frames", () => lib.deep(100, input));
bench("1000 frames", () => lib.noop(1000, input));
bench("url.parse() from node_modules under 1000 frames", () => lib.deep(1000, input));
bench("[input].map(url.parse) from node_modules", () => lib.map(input));

let warned = false;
bench("url.parse() from node_modules after the warning", () => {
  if (!warned) {
    warned = true;
    url.parse(input);
  }
  return lib.parse(input);
});

await run();
