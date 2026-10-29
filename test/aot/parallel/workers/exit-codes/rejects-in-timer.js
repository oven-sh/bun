setTimeout(() => {
  Promise.reject(new Error("timer"));
}, 5);
postMessage("end of entry");
