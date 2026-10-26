import { posix, win32 } from "path";
import { bench, run } from "../runner.mjs";

const pathConfigurations = [
  "",
  ".",
  "./",
  ["", ""].join("|"),
  ["./abc.js"].join("|"),
  ["foo/bar", "/tmp/file/", "..", "a/../subfile"].join("|"),
  ["a/b/c/", "../../.."].join("|"),
  ["/foo/bar/baz.js"].join("|"),
  ["/foo/bar", "./baz"].join("|"),
  ["/föö/bär", "bäz"].join("|"),
];

pathConfigurations.forEach(paths => {
  const args = paths.split("|");

  bench(`resolve(${args.map(a => JSON.stringify(a)).join(", ")})`, () => {
    globalThis.abc = posix.resolve(...args);
  });
});

const win32PathConfigurations = [
  ["index.ts"].join("|"),
  ["src", "index.ts"].join("|"),
  ["C:\\"].join("|"),
  ["C:\\foo\\bar\\baz.js"].join("|"),
  ["C:\\foo", "bar", "baz"].join("|"),
  ["C:\\föö", "bär"].join("|"),
];

win32PathConfigurations.forEach(paths => {
  const args = paths.split("|");

  bench(`win32.resolve(${args.map(a => JSON.stringify(a)).join(", ")})`, () => {
    globalThis.abc = win32.resolve(...args);
  });
});

const manySegments = new Array(1000).fill(Buffer.alloc(100, "a").toString());

bench(`resolve("/", ...1000 segments of 100 bytes)`, () => {
  globalThis.abc = posix.resolve("/", ...manySegments);
});

bench(`win32.resolve("C:\\\\", ...1000 segments of 100 bytes)`, () => {
  globalThis.abc = win32.resolve("C:\\", ...manySegments);
});

await run();
