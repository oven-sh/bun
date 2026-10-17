// What the application's tsconfig.json says of class fields goes for the application's classes. Bun's own modules are as Bun built them.
import { Readable, Writable } from "node:stream";
class Own { first: number | undefined; second = 2; constructor() { this.first = 1; } }
const readable: any = new Readable({ read() {} });
const writable: any = new Writable({ write(chunk: unknown, encoding: unknown, done: () => void) { done(); } });
console.log(Object.keys(new Own()).join());
console.log(Object.keys(readable._readableState).join());
console.log(Object.keys(writable._writableState).join());
