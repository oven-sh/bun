// An export of a module of Bun that is not a property of what require() answers: the import, `ns.name` and the namespace object hold one value.
import AbortController, { __esModule } from "abort-controller";
import * as abortController from "abort-controller";
import Module, { wrapper, wrap } from "node:module";
import * as nodeModule from "node:module";
import isValidUTF8 from "utf-8-validate";
import * as utf8Validate from "utf-8-validate";
import Database, { Database as NamedDatabase } from "bun:sqlite";
import * as sqlite from "bun:sqlite";
export { default as ReexportedDatabase } from "bun:sqlite";
import * as self from "./exports-that-only-the-namespace-holds.js";

const read = (object, name) => object[name];

console.log("abort-controller.__esModule:", __esModule, abortController.__esModule, read(abortController, "__esModule"), require("abort-controller").__esModule);
console.log("abort-controller.default:", AbortController === globalThis.AbortController, abortController.default === AbortController, require("abort-controller") === AbortController);
console.log("abort-controller.default constructs:", new AbortController().signal.aborted, AbortController.name, AbortController.prototype === globalThis.AbortController.prototype, require("abort-controller").prototype === AbortController.prototype);

console.log("node:module.wrapper is one object:", wrapper === wrapper, wrapper === nodeModule.wrapper, wrapper === read(nodeModule, "wrapper"));
console.log("Module.wrapper is another object each time:", Module.wrapper === Module.wrapper, wrapper === Module.wrapper, JSON.stringify(wrapper) === JSON.stringify(Module.wrapper));
console.log("node:module.wrap:", wrap === Module.wrap, wrap === nodeModule.wrap);

console.log("utf-8-validate.default is one function:", isValidUTF8 === utf8Validate.default, isValidUTF8 === read(utf8Validate, "default"), isValidUTF8 === require("utf-8-validate"));
console.log("utf-8-validate:", isValidUTF8(Buffer.from("text")), isValidUTF8(Buffer.from([0xff])), require("utf-8-validate")(Buffer.from([0xff])));

console.log("bun:sqlite.default:", Database === NamedDatabase, sqlite.default === NamedDatabase, read(sqlite, "default") === NamedDatabase, self.ReexportedDatabase === NamedDatabase);
console.log("require(bun:sqlite):", typeof require("bun:sqlite"), require("bun:sqlite").default === Database, (await import("bun:sqlite")).default === Database);
const database = new Database(":memory:");
console.log(database instanceof NamedDatabase, database.query("select 1 + 2 as sum").get());
database.close();
