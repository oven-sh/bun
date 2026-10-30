import "./slow-b.mjs";
console.log("slow-a begins");
await new Promise(resolve => setTimeout(resolve, 50));
console.log("slow-a ends");
