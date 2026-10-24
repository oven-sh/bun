// What an asynchronous event listener throws is reported as an uncaught exception on the next tick.
process.on("uncaughtException", error => console.log("uncaught: " + error));
const target = new EventTarget();
target.addEventListener("event", async () => {
  throw "thrown by the listener";
});
target.dispatchEvent(new Event("event"));
console.log("dispatched");
