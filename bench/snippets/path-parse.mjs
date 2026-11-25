import { posix, win32 } from "path";
import { bench, run } from "../runner.mjs";

const paths = [
  "/home/user/dir/file.txt",
  "/home/user/dir/",
  "file.txt",
  "/root",
  "",
  // Latin-1 characters in an 8-bit string.
  "/home/jos\u00e9/r\u00e9pertoire/\u00e9t\u00e9.txt",
  // UTF-16 code units.
  "/home/\u30e6\u30fc\u30b6\u30fc/\u30d5\u30a9\u30eb\u30c0/\u30d5\u30a1\u30a4\u30eb.txt",
  // An unpaired surrogate.
  "/home/user/dir/\ud800.txt",
];

paths.forEach(p => {
  bench(`posix.parse(${JSON.stringify(p)})`, () => {
    globalThis.abc = posix.parse(p);
  });
});

paths.forEach(p => {
  bench(`win32.parse(${JSON.stringify(p)})`, () => {
    globalThis.abc = win32.parse(p);
  });
});

await run();
