// A CommonJS module that an ES module imports runs while the importing graph is linked. Here such modules require ES modules of that same graph, which are not linked yet:
// those link and run at once, together with the CommonJS modules they import, and the outer link passes over them. Several modules import the same CommonJS module.
// The compiled program runs the CommonJS modules in the order of the import statements. `bun run` runs them in the order in which its loader finished fetching them, so the expected output is written down.
import { a } from "./a.mjs";
import first from "./first.cjs";
import { b } from "./b.mjs";
import second from "./second.cjs";
import { c } from "./c.mjs";
import { left } from "./cycle-left.mjs";
console.log("main runs:", a, first, b, second, c, left());
