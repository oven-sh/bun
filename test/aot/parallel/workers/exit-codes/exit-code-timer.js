process.exitCode = 5;
setTimeout(() => {
  Promise.reject(new Error("timer"));
}, 5);
