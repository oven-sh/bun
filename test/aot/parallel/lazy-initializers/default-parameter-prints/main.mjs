// What the initializer runs prints. It prints where the declaration stands: in front of what the importing file prints.
// Alone: what is put off goes by all that the executable holds
import { read } from "./m.mjs";
console.log("main starts");
console.log(JSON.stringify(read()).length > 0, "main has read");
