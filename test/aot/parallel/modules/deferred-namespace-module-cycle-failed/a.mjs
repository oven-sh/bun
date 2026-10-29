import "./b.mjs";
console.log("a begins");
await 0;
throw new Error("thrown by a behind its await");
