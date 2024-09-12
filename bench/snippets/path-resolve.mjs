import { bench, run } from "mitata";
import { posix } from "path";

const pathConfigurations = [
  "",
  ["", ""].join("|"),
  ["foo/bar", "/tmp/file/", "..", "a/../subfile"].join("|"),
  ["a/b/c/", "../../.."].join("|"),
];

pathConfigurations.forEach(paths => {
  const args = paths.split("|");

  bench(`resolve(${paths})`, () => {
    globalThis.abc = posix.resolve(...args);
  });
});

await run();
