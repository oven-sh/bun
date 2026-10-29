// A CommonJS file requires an ES module that imports a CommonJS file and another ES module. The file calls import() on that module, which the loader has asked for and not yet fetched: the call loads it. That module imports the file that requires, so the loader of the run time loads the graph.
import "./lines.cjs";
import "./requires.cjs";
import "./imports.cjs";
lines.push("main runs");
