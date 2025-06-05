console.log("Child process started");
console.log("Child argv:", process.argv);
console.log("Child execArgv:", process.execArgv);

// Do some work to trigger trace events
setImmediate(() => {
  console.log("Immediate callback");
});

setTimeout(() => {
  console.log("Timer callback");
  process.exit(0);
}, 10);
