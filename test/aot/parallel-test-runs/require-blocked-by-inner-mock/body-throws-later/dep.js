import { inner } from "./inner.js";
globalThis.bodies++;
console.log("| the body starts");
throw new Error("body boom " + inner);
