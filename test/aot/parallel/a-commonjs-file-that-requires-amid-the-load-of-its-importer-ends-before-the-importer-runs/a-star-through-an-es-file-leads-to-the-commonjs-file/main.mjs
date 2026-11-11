// As its neighbor, with the CommonJS file behind two stars.
import bridge from "./bridge.cjs";
import tool from "./tool.cjs";
console.log("main:", bridge, "| tool is", typeof tool);
