false && require("./missing-1");
true || require("./missing-2");
0 ?? require("./missing-3");
console.log(1 ? "yes" : require("./missing-4"));
if (!1) require("./missing-5");
if ("") require.resolve("./missing-6");
if (typeof 1 === "string") require("./missing-7");
if (1 + 1 === 3) require("./missing-8");
console.log("ran");
