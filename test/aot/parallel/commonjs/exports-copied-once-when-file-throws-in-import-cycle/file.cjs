Object.defineProperty(exports, "first", { enumerable: true, get: () => (console.log("getter runs"), 1) });
require("./root.mjs");
