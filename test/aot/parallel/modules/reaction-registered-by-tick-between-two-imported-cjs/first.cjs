console.log("first runs");
const promise = Promise.resolve();
promise.then(() => console.log("reaction registered first"));
process.nextTick(() => {
  console.log("tick of first");
  promise.then(() => console.log("reaction registered second"));
});
exports.x = 1;
