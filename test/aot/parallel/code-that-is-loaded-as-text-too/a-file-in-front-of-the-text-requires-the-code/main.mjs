import "./early.mjs";
import * as text from "./code.js" with { type: "text" };
const code = await import("./code.js");
console.log(Object.keys(text).join(), Object.keys(code).join(), Object.keys(globalThis.early).join(), globalThis.ran);
