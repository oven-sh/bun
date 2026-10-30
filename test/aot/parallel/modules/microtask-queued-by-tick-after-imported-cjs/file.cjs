const promise = Promise.resolve();
promise.then(() => console.log("reaction of the file"));
process.nextTick(() => {
  console.log("tick");
  queueMicrotask(() => console.log("job of the tick"));
});
exports.x = 1;
