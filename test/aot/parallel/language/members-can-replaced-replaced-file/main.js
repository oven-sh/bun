// One file puts globals back under names that are made at run time, so the other file's `Promise`, `Math` and `console` could be anything. What the other file does to the members that can be replaced is the same as without the first file.
import "./defines-globals.js";
import "./replaces-members.js";
