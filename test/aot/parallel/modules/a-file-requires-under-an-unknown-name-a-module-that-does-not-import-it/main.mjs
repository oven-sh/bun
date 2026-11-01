// x.cjs runs while the graph of the root is loaded, and requires, under a name that the build does not know, an ES module of that graph which does not import x.cjs.
// The graph of the root still waits for x.cjs: the module runs inside the require(), the root behind the end of the file.
// Entry points: ./n.mjs
import "./x.cjs";
import "./n.mjs";
console.log("main runs");
