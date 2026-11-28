import * as text from "./code.js" with { type: "text" };
require("./code.js");
console.log(Object.keys(text).join(), Object.keys(await import("./code.js")).join(), globalThis.ran);
