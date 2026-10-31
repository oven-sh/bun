// `require` of lib/ and of chunks/, imported here, get whole paths that start at this folder. A whole path names the same file whichever `require` gets it; a relative one starts at the folder of the `require`.
import path from "node:path";
import { __require } from "./chunks/shared.mjs";
import * as lib from "./lib/require.mjs";
import { require } from "./lib/require.mjs";
import { require as passedOn } from "./passes-on/index.mjs";

const here = import.meta.dirname;
const whole = here + "/first.cjs";
const isFirst = process.argv.length < 99;
const name = isFirst ? "first" : "second";

console.log("added:", require(import.meta.dirname + "/first.cjs"), require(import.meta.dir + "/second.cjs"));
console.log("in a template:", require(`${import.meta.dirname}/first.cjs`));
console.log("joined:", require(path.join(import.meta.dirname, "first.cjs")), require(path.resolve(import.meta.dirname, "lib", "first.cjs")));
console.log("held by a constant:", require(here + "/first.cjs"), require(whole));
console.log("below and back:", require(import.meta.dirname + "/lib/first.cjs"), require(import.meta.dirname + "/lib/../second.cjs"));
console.log("relative:", require("./first.cjs"), require("../first.cjs"));
console.log("a part is computed:", require(import.meta.dirname + "/" + name + ".cjs"), require(`${import.meta.dir}/${name}.cjs`), require("./" + name + ".cjs"));
console.log("one of two:", require(isFirst ? import.meta.dirname + "/first.cjs" : import.meta.dirname + "/second.cjs"), require(isFirst ? "./first.cjs" : "./second.cjs"));
console.log("through a namespace:", lib.require(import.meta.dirname + "/first.cjs"), lib.require("./first.cjs"));
console.log("passed on by a third folder:", passedOn(import.meta.dirname + "/first.cjs"), passedOn("./first.cjs"));
console.log("of a shared chunk:", __require(path.join(import.meta.dirname, "first.cjs")), __require("./first.cjs"));
