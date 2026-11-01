// The one load under a name that the build does not know is an import(): what it loads begins in a job, when no file is unfinished. So this file still reads
// what it imports behind the stores, and a const that holds a function, a class or a regular expression needs nothing that says whether its declaration has run.
// STATISTIC: DeadZonesKeptBesideDefinitions = 0
import { arrow } from "./arrow.mjs";
import { Kind } from "./kind.mjs";
import { pattern } from "./pattern.mjs";
import { text } from "./text.mjs";
if (process.argv.length > 100) import(process.argv[2]).then(namespace => console.log(Object.keys(namespace)));
console.log(arrow(1), new Kind().run(), pattern.test("aab"), text);
