// What the thenable of a listener rejects with is reported to "uncaughtException", and not an older error that a tick caught.
process.on("uncaughtException", error => {
  console.log(`heard ${error.message}`);
});
const target = new EventTarget();
target.addEventListener("made-up", () => ({ then: (resolve, reject) => reject(new Error("rejected by the listener")) }));
process.nextTick(() => {
  try {
    throw new Error("caught in a tick");
  } catch {}
});
target.dispatchEvent(new Event("made-up"));
console.log("behind");
