// What the initializer runs prints. It prints where the declaration stands: in front of what the importing file prints.
import { read } from "./m.mjs";
console.log("main starts");
console.log(JSON.stringify(read()).length > 0, "main has read");
