import { sep, posix, win32, basename } from "node:path";
import path from "node:path";
console.log(sep, posix.sep, win32.sep, basename("/a/b.txt"), path.posix === posix, typeof path.resolve, path.join("a", "b"));
