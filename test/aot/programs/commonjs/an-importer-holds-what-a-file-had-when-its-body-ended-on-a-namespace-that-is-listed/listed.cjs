exports.steps = 0;
process.nextTick(() => {
  exports.steps += 100;
});
Promise.resolve().then(() => {
  exports.steps++;
});
