queueMicrotask(() => {
  Promise.reject(new Error("microtask"));
});
postMessage("end of entry");
