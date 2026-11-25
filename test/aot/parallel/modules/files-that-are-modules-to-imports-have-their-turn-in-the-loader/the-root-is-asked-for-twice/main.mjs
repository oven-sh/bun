console.log("main begins");
await Promise.all([import("./top.mjs"), import("./top.mjs")]);
await import("./top.mjs");
console.log("main ends");
