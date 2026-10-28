// A CommonJS file requires an ES module that imports two CommonJS files. The first of them calls import() on the second, which the loader has asked for and not yet fetched: the call loads it. The second calls import() on the file that requires, so the loader of the run time loads the graph.
import "./lines.cjs";
import "./requires.cjs";
import "./imports.cjs";
lines.push("main runs");
