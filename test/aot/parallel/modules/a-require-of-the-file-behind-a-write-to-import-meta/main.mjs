// A path of import.meta is written to, late, by another file, and back again. The run asks whether a require() is made for the file: here it is, and it loads.
// Nothing else names the files that are required.
import "./handed.mjs";
import "./late.mjs";
import "./twice.mjs";
