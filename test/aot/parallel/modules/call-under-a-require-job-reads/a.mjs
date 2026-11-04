import("./b.mjs").then(() => console.log("b got"));
Promise.resolve().then(() => console.log("job sees", globalThis.set));
