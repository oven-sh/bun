// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
process.on("uncaughtException", error => console.log("caught", error.message));
const target = new EventTarget();
target.addEventListener("x", () => {
  throw new Error("in a listener");
});
target.dispatchEvent(new Event("x"));
console.log("dispatched");
