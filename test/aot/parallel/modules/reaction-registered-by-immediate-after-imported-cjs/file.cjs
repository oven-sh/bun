const promise = Promise.resolve();
promise.then(() => console.log("reaction registered first"));
setImmediate(() => {
  console.log("immediate");
  promise.then(() => console.log("reaction registered second"));
});
exports.x = 1;
