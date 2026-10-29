lines.push("file begins");
require("./required.mjs");
lines.push("file has required");
track("back", import("./back.mjs"));
throw new Error("file.cjs throws");
