import { posix, win32 } from "path";
import { bench, run } from "../runner.mjs";

const paths = ["/home/user/dir/file.txt", "/home/user/dir/", "file.txt", "/root", ""];

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
