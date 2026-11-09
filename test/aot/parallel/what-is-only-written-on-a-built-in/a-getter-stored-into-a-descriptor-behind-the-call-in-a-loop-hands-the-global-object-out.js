function lay() {
  const descriptor = { configurable: true };
  for (let round = 0; round < 2; round++) {
    Object.defineProperty(globalThis, "whole", descriptor);
    descriptor.get = function () {
      return this;
    };
  }
}
lay();
globalThis.whole.process.nextTick(() => console.log("ticked"));
