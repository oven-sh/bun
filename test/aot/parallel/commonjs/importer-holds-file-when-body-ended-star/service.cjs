exports.ready = false;
exports.steps = 0;
async function start() {
  for (let step = 0; step < 10; step++) {
    await null;
    exports.steps++;
  }
  exports.ready = true;
}
start();
queueMicrotask(() => {
  exports.ready = "in a job";
});
