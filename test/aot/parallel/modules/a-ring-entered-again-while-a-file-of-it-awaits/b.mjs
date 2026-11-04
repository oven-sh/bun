import "./a.mjs";
console.log("b starts");
globalThis.enter("b");
await new Promise(resolve => setTimeout(resolve, 1));
globalThis.enter("b behind its await");
console.log("b ends");
