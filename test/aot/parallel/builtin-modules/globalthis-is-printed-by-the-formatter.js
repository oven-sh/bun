// The formatter comes from the global object to `process`, and there to process.allowedNodeEnvironmentFlags: an instance of a class of Bun's library that extends Set and has a `size` of its own, which the formatter reads.
console.log(Bun.inspect(globalThis).length > 100);
