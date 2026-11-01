// A top-level for await over a promise that rejects before a write to a locked built-in.
process.on("uncaughtException", error => {
  console.log("caught", error.message);
});
for await (const value of [Promise.reject(new Error("early"))]) console.log(value);
Array.prototype.push = function () {};
