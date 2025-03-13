if (IS_BUN_DEVELOPMENT) {
  // After 1.2.6 is released, this can just be `ASSERT`
  globalThis.DEBUG = {
    ASSERT: function ASSERT(condition: any, message?: string): asserts condition {
      if (!condition) {
        if (typeof Bun !== "undefined") {
          console.assert(false, "DEBUG.ASSERTION FAILED" + (message ? `: ${message}` : ""));
        } else {
          console.error("DEBUG.ASSERTION FAILED" + (message ? `: ${message}` : ""));
        }
      }
    },
  };
}
