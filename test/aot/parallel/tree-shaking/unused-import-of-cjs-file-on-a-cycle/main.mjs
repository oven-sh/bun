// A CommonJS file leads back to an ES module that imports it, and nothing reads that import. The package says that its files have no side effects,
// so the import goes, and mostly the file with it.
// What this file reads off such a CommonJS file is laid before that file requires anything: in plain Bun the order of the two bodies is not the same in every run.
// On a busy machine `bun <file>` still ends with a TypeError in a few runs of a hundred: which text the threads of its transpiler finish first decides. Held to one thread it prints
// what it prints in the other runs and what the executable prints, which stands here.
import reported from "./b.mjs";
import namesToo from "names-too/b.mjs";
import importCall from "import-call/b.mjs";
import handedOn from "handed-on/b.mjs";
import starBarrel from "star-barrel/b.mjs";
import between, { back } from "between/a.mjs";
import listed from "listed/b.mjs";
import readElsewhere from "read-elsewhere/b.mjs";
import elsewhere from "read-elsewhere/a.cjs";
console.log(reported, namesToo, importCall, handedOn, starBarrel, listed);
console.log(between, back());
console.log(readElsewhere, elsewhere.v, elsewhere.back());

/* Output:
7 names-too import-call handed-on star-barrel listed
between {}
read-elsewhere 1 read-elsewhere
*/
