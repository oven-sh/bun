// The `require` of another file comes through `export .. from`, a default export, a namespace import and a constant of this file.
import * as chunk from "./chunk.mjs";
import byDefault, { __require } from "./chunk.mjs";
import again from "./passes-it-on-again.mjs";
import { load } from "./passes-it-on.mjs";
const alias = __require;
const text: string = alias("./alias.cjs");
console.log(load("./reexported.cjs"), again("./reexported-twice.cjs"), byDefault("./default-export.cjs"));
console.log(chunk.__require("./namespace.cjs"), text, (__require as (name: string) => string)("./asserted.cjs"));
