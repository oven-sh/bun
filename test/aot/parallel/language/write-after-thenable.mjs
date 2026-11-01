// A top-level await of a thenable that rejects before a write to a locked built-in.
process.on("uncaughtException", error => {
  console.log("caught", error.message);
});
const failing = {
  then(resolve, reject) {
    reject(new Error("early"));
  },
};
await failing;
Array.prototype.push = function () {};
