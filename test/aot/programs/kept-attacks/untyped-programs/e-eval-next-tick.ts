// Untyped programs: e eval next tick. It prints what plain Bun prints.
process.nextTick(eval, process.argv.length > 99 ? "0" : "globalThis.ranTheString = true");
setTimeout(() => console.log((globalThis as any).ranTheString), 1);
