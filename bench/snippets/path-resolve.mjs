import { posix } from "path";
import { bench, run } from "../runner.mjs";

const pathConfigurations = [
  "",
  ".",
  "./",
  ["", ""].join("|"),
  ["./abc.js"].join("|"),
  ["foo/bar", "/tmp/file/", "..", "a/../subfile"].join("|"),
  ["a/b/c/", "../../.."].join("|"),
];

pathConfigurations.forEach(paths => {
  const args = paths.split("|");

  bench(`resolve(${args.map(a => JSON.stringify(a)).join(", ")})`, () => {
    globalThis.abc = posix.resolve(...args);
  });
});

await run();
