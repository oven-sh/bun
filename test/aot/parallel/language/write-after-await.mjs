// A top-level await of a promise that rejects before a write to a locked built-in, and an uncaughtException listener handles it.
process.on("uncaughtException", error => {
  console.log("caught", error.message);
});
await Promise.reject(new Error("early"));
Array.prototype.push = function () {};
