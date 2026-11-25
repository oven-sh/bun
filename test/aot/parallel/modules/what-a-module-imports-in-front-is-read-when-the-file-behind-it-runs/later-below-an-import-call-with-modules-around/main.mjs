console.log("main begins");
const top = await import("./top.mjs");
console.log("main ends", typeof top.load());
