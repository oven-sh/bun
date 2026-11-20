// tool.cjs requires two modules, each over a CommonJS file.
import bridge from "./bridge.cjs";
import tool from "./tool.cjs";
console.log("main:", bridge, "| tool is", typeof tool);
