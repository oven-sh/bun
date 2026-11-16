addEventListener("message", event => {
  postMessage(typeof event.target.process.finalization);
});
