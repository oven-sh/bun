import * as text from "./code.js" with { type: "text" };
import first from "./first.cjs";
const code = await import("./code.js");
console.log(Object.keys(text).join(), Object.keys(code).join(), Object.keys(first.code).join(), globalThis.ran);
