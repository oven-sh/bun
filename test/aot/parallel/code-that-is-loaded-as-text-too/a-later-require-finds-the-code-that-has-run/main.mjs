import * as text from "./code.js" with { type: "text" };
import first from "./first.cjs";
import later from "./later.cjs";
console.log(Object.keys(text).join(), Object.keys(first.code).join(), first.code === later.again(), globalThis.ran);
