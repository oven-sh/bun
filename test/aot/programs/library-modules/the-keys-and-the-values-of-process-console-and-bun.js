// Native code that lists keys reads no member, and native code that reads every member finds every member.
console.log(Object.keys(process).length > 10, Object.getOwnPropertyNames(process).length > 10, Reflect.ownKeys(globalThis).length > 50);
console.log(Object.values(process).length > 10, Object.entries(console).length > 5, Object.entries(Bun).length > 10);
console.log(Object.getPrototypeOf(process) !== null, typeof Object.assign({}, console).log);
