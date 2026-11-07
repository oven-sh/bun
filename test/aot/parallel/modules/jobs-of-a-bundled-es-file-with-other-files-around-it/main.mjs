// The bundle is the first file of the graph to run, two levels below the entry point; a built-in module is imported in front of it, an ES file and a second bundle behind it.
import { sep } from "node:path";
import { x } from "./middle.mjs";
import "./behind.mjs";
import { x as y } from "./second-bundle.mjs";
console.log("body: main", x, y, sep.length);
