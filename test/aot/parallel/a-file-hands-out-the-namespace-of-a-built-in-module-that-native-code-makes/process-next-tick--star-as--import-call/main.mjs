const { held } = await import("./lib.mjs");
console.log(typeof held.nextTick(() => {}));
