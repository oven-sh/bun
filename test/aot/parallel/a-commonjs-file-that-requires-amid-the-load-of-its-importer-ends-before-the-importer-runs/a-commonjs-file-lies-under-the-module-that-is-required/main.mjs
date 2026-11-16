// tool.cjs runs while the graph of panel.mjs is loaded, and requires colors.mjs, under which a CommonJS file lies. panel.mjs runs when tool.cjs has ended.
import bridge from "./bridge.cjs";
import tool from "./tool.cjs";
console.log("main:", bridge, "| tool is", typeof tool);
