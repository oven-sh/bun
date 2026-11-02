setImmediate(() => {
  Promise.reject(new Error("immediate"));
});
postMessage("end of entry");
