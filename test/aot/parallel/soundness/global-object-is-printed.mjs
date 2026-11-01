// Bun.inspect() walks the global object and sizes the set behind process.allowedNodeEnvironmentFlags. Also built by ../../flow-schedules.test.ts.
console.log(Bun.inspect(globalThis).length > 100);
