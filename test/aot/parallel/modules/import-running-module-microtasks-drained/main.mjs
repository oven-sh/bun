// A file imports itself while its body runs and then drains the microtask queue. The import settles once the body has ended.
const namespace = await import("./running.cjs");
console.log(namespace.default.log.join(" | "));
await namespace.default.self;
console.log(namespace.default.log.join(" | "));
