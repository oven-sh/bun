Object.defineProperty(globalThis, "whole", {
  get() {
    return this;
  },
  configurable: true,
});
globalThis.whole.process.nextTick(() => console.log("ticked"));
