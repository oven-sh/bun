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
  // Latin-1 characters in 8-bit strings.
  ["/tmp/\u00e9t\u00e9", "a/../subfile"],
  // UTF-16 code units.
  ["/tmp/\u30d5\u30a9\u30eb\u30c0", "a/../\u30d5\u30a1\u30a4\u30eb"],
  // A 16-bit string and 8-bit ones.
  ["foo/bar", "/tmp/\u30d5\u30a9\u30eb\u30c0/", "..", "a/../subfile"],
  // An unpaired surrogate.
  ["/tmp/\ud800", "a/../subfile"],
];

pathConfigurations.forEach(paths => {
  // The parts of a string that was split share its storage, so strings of two widths are given as they are.
  const args = typeof paths === "string" ? paths.split("|") : paths;

  bench(`resolve(${args.map(a => JSON.stringify(a)).join(", ")})`, () => {
    globalThis.abc = posix.resolve(...args);
  });
});

await run();
