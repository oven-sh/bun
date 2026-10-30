// As reaction-registered-by-tick-after-imported-cjs, but a setImmediate() callback registers the second reaction: the graph has run when the callback does.
import "./file.cjs";
console.log("importer runs");
