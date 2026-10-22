// Buffer reached through the module node:buffer (a named import, the namespace, a dynamic import, a pattern over it, require) is the Buffer of the global object, and its members work.
import { Buffer as Named } from "node:buffer";
import * as all from "node:buffer";
import { createRequire } from "node:module";
const later = await import("node:buffer");
const { Buffer: FromPattern } = await import("node:buffer");
const required = createRequire(import.meta.url)("node:buffer");
console.log("named import", Named.from("abc", "utf8").length, JSON.stringify(Named.alloc(2).toJSON()), Named === Buffer);
console.log("namespace", all.Buffer.from("abc", "utf8").length, JSON.stringify(all.Buffer.alloc(2).toJSON()), all.Buffer === Buffer);
console.log("dynamic import", later.Buffer.from("abc", "utf8").length, JSON.stringify(later.Buffer.alloc(2).toJSON()), later.Buffer === Buffer);
console.log("pattern", FromPattern.from("abc", "utf8").length, JSON.stringify(FromPattern.alloc(2).toJSON()), FromPattern === Buffer);
console.log("require", required.Buffer.from("abc", "utf8").length, JSON.stringify(required.Buffer.alloc(2).toJSON()), required.Buffer === Buffer);
