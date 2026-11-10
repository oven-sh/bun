// What a listener throws is reported at the next tick, whoever laid the listener: here the setter of `onabort`.
// Exit code: 1
const controller = new AbortController();
controller.signal.onabort = () => {
  throw new Error("made up");
};
controller.abort();
console.log("behind");
