const text = await import("./code.js", { with: { type: "text" } });
require("./code.js", { type: "text" });
console.log(Object.keys(text).join(), Object.keys(await import("./code.js")).join(), globalThis.ran);
