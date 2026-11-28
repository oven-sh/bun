// A listener whose handleEvent is not callable is reported to "uncaughtException", and not an older error that the program caught.
try {
  throw new Error("caught before");
} catch {}
process.on("uncaughtException", error => {
  console.log(`heard ${error.message}`);
});
const target = new EventTarget();
target.addEventListener("made-up", { handleEvent: 123 });
target.dispatchEvent(new Event("made-up"));
console.log("behind");
