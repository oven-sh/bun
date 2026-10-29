globalThis.show("a module that awaits");
await Promise.resolve();
globalThis.show("behind the await");
