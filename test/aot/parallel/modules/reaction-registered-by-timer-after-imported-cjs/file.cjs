const promise = Promise.resolve();
promise.then(() => console.log("reaction registered first"));
setTimeout(() => {
  console.log("timer");
  promise.then(() => console.log("reaction registered second"));
}, 0);
exports.x = 1;
