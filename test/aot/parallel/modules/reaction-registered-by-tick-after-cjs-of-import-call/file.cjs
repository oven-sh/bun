const promise = Promise.resolve();
promise.then(() => console.log("reaction registered first"));
process.nextTick(() => {
  console.log("tick");
  let chain = promise.then(() => console.log("reaction registered second"));
  for (let job = 1; job <= 12; job++) chain = chain.then(() => console.log("job", job));
});
exports.x = 1;
