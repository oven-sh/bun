// process.getBuiltinModule is reached through `globalThis.process` or `global.process`, through `?.` and through a type assertion, and the name is a constant: each module is in, though nothing else names it. The output is that of plain Bun.
interface Hooks {
  AsyncLocalStorage: unknown;
}
const hooks = (
  globalThis as {
    process?: { getBuiltinModule?: (id: string) => unknown };
  }
).process?.getBuiltinModule?.("async_hooks") as Hooks | undefined;
console.log("assertion and chain:", typeof hooks?.AsyncLocalStorage);
console.log("plain:", typeof globalThis.process.getBuiltinModule("node:dgram").createSocket);
console.log("chain:", typeof globalThis.process?.getBuiltinModule?.("node:readline")?.createInterface);
console.log("global:", typeof global.process.getBuiltinModule("node:querystring").parse);
console.log("no such module:", globalThis.process.getBuiltinModule("node:no-such-module"));

function shadowed(globalThis: { process: { getBuiltinModule(name: string): string } }) {
  return globalThis.process.getBuiltinModule("node:tty");
}
console.log("a parameter of that name:", shadowed({ process: { getBuiltinModule: name => "mine " + name } }));
