import { posix, win32 } from "path";
import { bench, run } from "../runner.mjs";

const flat = text => (text.charCodeAt(0), text);
// The same characters in 16-bit storage.
const wide = text => flat(flat("日" + text).slice(1));

const long = "/modules/@scope/package-name/dist/esm".repeat(50);
const objects = {
  "{dir, base}": { dir: "/home/user/dir", base: "file.txt" },
  "{root, name, ext}": { root: "/", name: "file", ext: ".txt" },
  "{dir, name, ext}": { dir: "/home/user/dir", name: "file", ext: "txt" },
  "parse(p)": posix.parse("/home/user/dir/file.txt"),
  "{dir, base} in 16-bit storage": { dir: wide("/home/user/dir"), base: wide("file.txt") },
  "{dir, base} outside ASCII": { dir: "/home/usér/プロジェクト", base: "索引.html" },
  "{dir, base} of 1850 characters": { dir: long, base: "index.js" },
};

for (const [name, { format }] of [
  ["posix", posix],
  ["win32", win32],
]) {
  for (const [label, object] of Object.entries(objects)) {
    bench(`${name}.format(${label})`, () => {
      globalThis.abc = format(object);
    });
    // What reads the answer needs it as one string.
    bench(`${name}.format(${label}), then its first character`, () => {
      globalThis.abc = format(object).charCodeAt(0);
    });
  }
  bench(`${name}.format(a literal {dir, base})`, () => {
    globalThis.abc = format({ dir: "/home/user/dir", base: "file.txt" });
  });
}

await run();
