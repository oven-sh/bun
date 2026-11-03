process.on("exit", code => console.log("exit-listener-timer.js: exit listener", code, process.exitCode));
setTimeout(() => {
  Promise.reject(new Error("timer"));
}, 5);
