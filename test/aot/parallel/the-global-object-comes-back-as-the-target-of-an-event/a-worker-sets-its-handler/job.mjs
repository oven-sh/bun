onmessage = event => {
  postMessage(typeof event.currentTarget.process.finalization);
};
