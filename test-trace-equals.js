// Test with equals sign format
console.log("Running with --trace-event-categories=node.environment");
console.log("process.argv:", process.argv);
console.log("process.execArgv:", process.execArgv);

setImmediate(() => {
  console.log("Immediate callback");
});

setTimeout(() => {
  console.log("Timer callback");
  process.exit(0);
}, 10);
