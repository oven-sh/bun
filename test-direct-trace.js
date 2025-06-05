console.log("Direct run with trace events");
console.log("process.argv:", process.argv);
console.log("process.execArgv:", process.execArgv);

// Add some events to trigger trace output
setImmediate(() => {
  console.log("Immediate callback");
});

setTimeout(() => {
  console.log("Timer callback");
  process.exit(0);
}, 10);
