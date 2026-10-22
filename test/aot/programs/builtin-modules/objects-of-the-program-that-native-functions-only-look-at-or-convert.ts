// Objects of the program that a native function only looks at or converts: a validated build has to find the row of each.
class Delay { valueOf() { return 1000; } }
class Keyed extends Map<number, number> {}
class Listed extends Set<number> {}
const say = (...values: unknown[]) => console.log(...values);
say(typeof AbortSignal.timeout(new Delay() as unknown as number).aborted, (Keyed as any)[Symbol.species] === Keyed, (Listed as any)[Symbol.species] === Listed);
const registry = new FinalizationRegistry((held: Delay) => say(held));
registry.register(new Delay(), new Delay()); say(registry.unregister(new Delay()));
const holder = { get made() { return new Delay(); }, kept: new Delay() };
say((holder as any).__lookupGetter__("made").call(holder) instanceof Delay, (holder as any).__lookupSetter__("made"), (holder as any).__lookupGetter__("kept"));
say(Object.getOwnPropertyDescriptor(holder, "kept")!.value instanceof Delay, Error.stackTraceLimit + 0 > 0, new TypeError("x").name.length, TypeError.prototype.message.length);
say(new WebAssembly.Global({ value: "externref", mutable: true }, holder).value === holder, navigator.hardwareConcurrency > 0, navigator.userAgent.length > 0, navigator.platform.length > 0);
say(Bun.enableANSIColors === true || Bun.enableANSIColors === false, Bun.dns.ADDRCONFIG + Bun.dns.ALL + Bun.dns.V4MAPPED > 0, typeof (Bun.dns as any).resolve, require("node:module").builtinModules.includes("fs"));
process.exit(0);
