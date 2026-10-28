// A file named .mjs without `import` and `export` calls require(). It is imported behind another file, and the two run in the order of the imports. Plain Bun prints another output.
import "./first.js";
import "./second.mjs";
