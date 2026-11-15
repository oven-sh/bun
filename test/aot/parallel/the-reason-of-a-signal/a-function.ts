const controller = new AbortController();
controller.abort(() => "called");
console.log(controller.signal.reason());
try {
  controller.signal.throwIfAborted();
} catch (thrown) {
  console.log(String(thrown === controller.signal.reason));
}
