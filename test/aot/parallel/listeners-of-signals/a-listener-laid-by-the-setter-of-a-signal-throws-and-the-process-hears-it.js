// What a listener throws reaches the listeners of "uncaughtException".
const controller = new AbortController();
controller.signal.onabort = () => {
  throw new Error("made up");
};
process.on("uncaughtException", error => {
  console.log(`heard ${error.message}`);
});
controller.abort();
console.log("behind");
