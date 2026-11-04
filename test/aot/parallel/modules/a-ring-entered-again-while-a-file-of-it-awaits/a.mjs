import "./b.mjs";
console.log("a starts");
await new Promise(resolve => setTimeout(resolve, 1));
globalThis.aHasEnded = true;
console.log("a ends");
