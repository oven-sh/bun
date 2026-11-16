globalThis[JSON.parse(`"__proto__"`)] = {
  get whole() {
    return this;
  },
};
globalThis.whole.process.nextTick(() => console.log("ticked"));
