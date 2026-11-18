see("drains begins");
globalThis.letFactoryEnd();
require("bun:jsc").drainMicrotasks();
see("drains ends");
exports.name = "drains";
