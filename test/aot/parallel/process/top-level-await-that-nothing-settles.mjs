// A top-level await that nothing can settle ends the program like Node: code 13, and nothing behind the await runs.
// Exit code: 13
console.log("before");
await new Promise(() => {});
console.log("after");
