console.log("Starting trace test");
console.log("Process argv:", process.argv);
console.log("CWD:", process.cwd());

// Add some timers to trigger trace events
setImmediate(() => {
  console.log("Immediate callback");
});

setTimeout(() => {
  console.log("Timer callback");
}, 10);

// Exit after a short delay
setTimeout(() => {
  console.log("Exiting...");
  process.exit(0);
}, 50);
