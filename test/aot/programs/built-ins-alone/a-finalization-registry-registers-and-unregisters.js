const registry = new FinalizationRegistry(() => {});
const target = {};
const token = {};
console.log(registry.register(target, "held", token) === undefined, registry.unregister(token), registry.unregister(token));
