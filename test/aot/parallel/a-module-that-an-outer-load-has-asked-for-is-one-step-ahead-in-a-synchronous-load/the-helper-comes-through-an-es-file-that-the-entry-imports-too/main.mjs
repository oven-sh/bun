import legacy from "./legacy.cjs";
import { helper as throughMiddle } from "./middle.mjs";
import helper from "./helper.cjs";
console.log("main:", legacy, "| helper is", typeof helper, "| through the middle it is", typeof throughMiddle);
