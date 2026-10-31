// A program with a top-level await that nothing can settle ends only when its timer has fired.
// Exit code: 13
console.log("before");
setTimeout(() => console.log("timer"), 50);
await new Promise(() => {});
console.log("after");
