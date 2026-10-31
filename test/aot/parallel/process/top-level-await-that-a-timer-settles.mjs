// A top-level await that a timer settles is waited for: the program goes on behind it and ends with code 0.
console.log("before");
await new Promise(resolve => setTimeout(resolve, 50));
console.log("after");
