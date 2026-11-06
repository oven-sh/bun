// What a named import of a native module holds is decided when the module is first loaded as an ES module. Here each module's object is changed before that, in a way that names no member in the text of a store.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

delete require("node:util/types").isDate;

const nameInPieces = ["Buf", "fer"].join("");
require("node:buffer")[nameInPieces] = function NotTheBuffer() {};

Object.defineProperty(process, "platform", { value: "no platform", configurable: true, enumerable: true, writable: true });

new Function("module", "module.StringDecoder = class FromTextNobodyCompiled {}")(require("node:string_decoder"));

Object.assign(require("bun:jsc"), { heapSize: function notTheHeapSize() { return "no size"; } });

Reflect.set(require("node:util/types"), "isMap", () => "no map");

Reflect.deleteProperty(require("node:constants"), "O_RDONLY");

delete require("bun:jsc")[["heap", "Stats"].join("")];

const { answers } = await import("./imports-the-names.mjs");
console.log(answers.join("\n"));
