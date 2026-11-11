const { held } = await import("./lib.mjs");
console.log(held.peek(Promise.resolve(1)));
