import { posix, win32 } from "path";
import { bench, run } from "../runner.mjs";

const flat = text => (text.charCodeAt(0), text);
// The same characters in one 16-bit string: what is joined of the parts of a 16-bit string is one.
const wide = text =>
  flat("日" + text)
    .split("日")
    .join("");

const paths = ["/home/user/dir/file.txt", "home/user/dir/file.txt", "C:\\Users\\dev\\file.txt", ""];
const head = flat(JSON.parse(JSON.stringify("/home/user/dir")));
const tail = flat(JSON.parse(JSON.stringify("/file.txt")));

for (const [name, { isAbsolute }] of [
  ["posix", posix],
  ["win32", win32],
]) {
  for (const p of paths) {
    bench(`${name}.isAbsolute(${JSON.stringify(p)})`, () => {
      globalThis.abc = isAbsolute(p);
    });
    if (p.length > 1) {
      const inWideStorage = wide(p);
      bench(`${name}.isAbsolute(${JSON.stringify(p)}) in 16-bit storage`, () => {
        globalThis.abc = isAbsolute(inWideStorage);
      });
    }
  }
  bench(`${name}.isAbsolute(a rope)`, () => {
    globalThis.abc = isAbsolute(head + tail);
  });
}

await run();
