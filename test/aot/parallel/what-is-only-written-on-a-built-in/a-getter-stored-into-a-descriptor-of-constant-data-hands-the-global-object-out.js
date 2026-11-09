function lay() {
  const descriptor = { configurable: true };
  descriptor.get = function () {
    return this;
  };
  Object.defineProperty(globalThis, "whole", descriptor);
}
lay();
globalThis.whole.process.nextTick(() => console.log("ticked"));
