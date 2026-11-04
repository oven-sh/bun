console.log("slow starts");
await new Promise(resolve => setTimeout(resolve, 1));
console.log("slow ends");
