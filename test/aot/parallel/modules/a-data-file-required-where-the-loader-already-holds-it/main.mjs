// The twin of a-data-file-required-before-the-loader-comes-to-its-import. The CommonJS file stands two levels down: the loader has loaded what main.mjs itself imports by the time it comes there,
// in front of the way to the file or behind it, and require() answers the namespace object. So it does once everything is loaded, and for a file that stands for a string always.
import inFront from "./in-front.json";
import { later } from "./between.mjs";
import behind from "./behind.json";
import "./level-1.mjs";
console.log("imported:", inFront.port, behind.port);
later();
