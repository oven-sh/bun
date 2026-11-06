process.nextTick(() => {
  Promise.reject(new Error("next tick"));
});
postMessage("end of entry");
