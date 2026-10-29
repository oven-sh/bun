// The exports of a module that native code makes are captured once, when the module is first loaded as an ES module: not when an importer runs, and not at the first use of the name.
import { titleAtTheStart } from "./runs-first-and-stores.mjs";
import process, { argv, title } from "node:process";
console.log("a module that ran in front of this one has stored:", argv[0] === "stored by the first module", title === process.title, title === titleAtTheStart, process.argv[0]);
process.title = title;

process.argv = ["stored by main"];
const later = await import("./imports-the-name-later.mjs");
console.log("a module that is loaded behind a store, of a module that was loaded in front of it:", later.read()[0] === argv[0], later.read() === argv, later.star()[0] === argv[0]);

const buffer = process.getBuiltinModule("node:buffer");
buffer.INSPECT_MAX_BYTES = 7;
const first = await import("./is-the-first-to-import-the-buffer-module.mjs");
console.log("a module that is the first to load it, behind a store:", first.read(), first.star());
buffer.INSPECT_MAX_BYTES = 8;
const second = await import("./is-the-second-to-import-the-buffer-module.mjs");
console.log("and the second, behind another store:", second.read(), first.read(), buffer.INSPECT_MAX_BYTES);

const namespace = await import("node:buffer");
buffer.INSPECT_MAX_BYTES = 9;
console.log("the namespace object:", namespace.INSPECT_MAX_BYTES, namespace["INSPECT" + "_MAX_BYTES"], namespace.default.INSPECT_MAX_BYTES);
