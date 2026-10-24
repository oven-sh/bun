// A module requires, from a function it calls while it runs, a module that imports from it.
import { log } from "./log.js";
import "./owner.js";
import "./reader.js";
import "./owner2.js";
import "./reader2.js";
const part = require("./part.cjs");
log.push("part " + part.early + " " + part.late + " " + part.seen);
console.log(log.join("\n"));
