import legacy from "./legacy.cjs";
import helper from "./helper.cjs";
console.log("main:", legacy, "| helper is", typeof helper, "| by import() it is", typeof (await import("./helper.cjs")).default);
