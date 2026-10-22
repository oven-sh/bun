// Built-ins applied by native code: every call of path.basename, a function out of a native binding, that the program spells out passes strings; here the tick queue passes the extra argument, and the function must still be there and refuse what is no string.
import { basename } from "node:path";

const honest = basename("/a/b.txt", ".txt");
const report = (error: NodeJS.ErrnoException): void => console.log(honest, error.code);
process.on("uncaughtException", report);
process.nextTick(basename, 5);
