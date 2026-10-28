// One file puts globals back under names that are made at run time, so the other file's `console`, `process` and `Intl` could be anything. What the other file does to their members is the same as without the first file.
import "./defines-globals.js";
import "./replaces-members.js";
