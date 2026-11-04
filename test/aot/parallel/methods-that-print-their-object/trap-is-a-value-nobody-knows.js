const trap = new CustomEvent("x", { detail: () => (depth, options, inspect) => "the trap went through an event: " + inspect({ a: 1 }) }).detail;
console.log(Object.create(new Proxy({}, { get: trap })));
