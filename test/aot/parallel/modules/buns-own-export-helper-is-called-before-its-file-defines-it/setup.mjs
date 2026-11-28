Object.defineProperty(globalThis, "hook", {
  get() {
    try {
      import.meta.require("./chunk.mjs");
    } catch (error) {
      console.log(error.name);
    }
  },
});
