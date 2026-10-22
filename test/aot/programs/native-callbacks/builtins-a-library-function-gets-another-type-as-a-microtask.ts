// Built-ins applied by native code: the one call of url.format that the program spells out passes an object of its own; here it is called without an argument, and the library's own `typeof` tests must still see what really arrives.
import { format } from "node:url";

const honest = format({ protocol: "http", host: "localhost", pathname: "/a" });
const report = (error: NodeJS.ErrnoException): void => console.log(honest, error.code);
process.on("uncaughtException", report);
queueMicrotask(format as any);
