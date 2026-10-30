const promise = Promise.resolve();
promise.then(() => console.log("reaction registered first"));
process.nextTick(() => {
  console.log("tick");
  promise.then(() => console.log("reaction registered second"));
});
exports.x = 1;
