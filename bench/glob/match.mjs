import micromatch from "micromatch";
import { bench, run } from "../runner.mjs";

const Glob = typeof Bun !== "undefined" ? Bun.Glob : undefined;
const doMatch = typeof Bun === "undefined" ? micromatch.isMatch : (a, b) => new Glob(b).match(a);

bench((Glob ? "Bun.Glob - " : "micromatch - ") + "**/*.js", () => {
  doMatch("foo/bar.js", "**/*.js");
});

bench((Glob ? "Bun.Glob - " : "micromatch - ") + "*.js", () => {
  doMatch("bar.js", "*.js");
});

await run({
  avg: true,
  min_max: true,
  percentiles: true,
});
