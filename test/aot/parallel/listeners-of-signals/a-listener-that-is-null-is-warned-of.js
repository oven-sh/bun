// addEventListener() emits a warning about a listener that is null or undefined: whoever calls it brings what emits the warning.
process.on("warning", warning => {
  console.log(`${warning.name}: ${warning.message} ${warning.type}`);
});
const controller = new AbortController();
controller.signal.addEventListener("abort", null);
new EventTarget().addEventListener("made-up", undefined);
console.log("behind");
