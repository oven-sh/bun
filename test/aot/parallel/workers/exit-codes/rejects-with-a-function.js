new Promise((resolve, reject) => {
  throw reject;
});
postMessage("rejects-with-a-function.js ran");
