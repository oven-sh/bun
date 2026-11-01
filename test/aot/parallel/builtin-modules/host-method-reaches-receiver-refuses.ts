// A method, a getter or a setter of a host class reaches a receiver that it refuses by many roads. Each receiver has a getter `constructor` that nothing else in the program names.
function told(run: () => unknown): string {
  try { return "answered " + String(run()); } catch (error: any) { return `${error?.code}: ${error?.message}`; }
}
const getterOf = (holder: object, key: string) => Object.getOwnPropertyDescriptor(holder, key)!.get!;
const setterOf = (holder: object, key: string) => Object.getOwnPropertyDescriptor(holder, key)!.set!;
console.log(1, told(() => getterOf(Blob.prototype, "size").call({ get constructor() { return { name: "One" }; } })));
console.log(2, told(() => getterOf(Response.prototype, "url").call({ get constructor() { return { name: "Two" }; } })));
console.log(3, told(() => Reflect.get(Blob.prototype, "size", { get constructor() { return { name: "Three" }; } })));
console.log(4, told(() => (Object.create(Blob.prototype, { constructor: { get() { return { name: "Four" }; } } }) as Blob).text()));
console.log(5, told(() => (Object.create(Blob.prototype, { constructor: { get() { return { name: "Five" }; } } }) as Blob).size));
console.log(6, told(() => ({ __proto__: Blob.prototype, get constructor() { return { name: "Six" }; }, read() { return super.text(); } } as any).read()));
console.log(7, told(() => Function.prototype.call.call(Blob.prototype.text, { get constructor() { return { name: "Seven" }; } })));
console.log(8, told(() => Blob.prototype.text.apply({ get constructor() { return { name: "Eight" }; } }, [])));
console.log(9, told(() => [{ get constructor() { return { name: "Nine" }; } }].map(Function.prototype.call, Blob.prototype.text)));
console.log(10, told(() => (TextDecoder.prototype.decode as any).call({ get constructor() { return { get name() { return "Ten"; } }; } })));
console.log(11, told(() => Request.prototype.clone.call({ get constructor() { return { name: { toString() { return "Eleven"; } } }; } } as any)));
console.log(12, told(() => Bun.CryptoHasher.prototype.update.call({ get constructor() { return { name: "Twelve" }; } } as any, "x")));
console.log(13, told(() => Bun.Glob.prototype.match.call({ get constructor() { return { name: "Thirteen" }; } } as any, "x")));
console.log(14, told(() => setterOf(Object.getPrototypeOf(Bun.file("x")), "name")?.call({ get constructor() { return { name: "Fourteen" }; } }, "y")));
console.log(15, told(() => Reflect.apply(Blob.prototype.text, { get constructor() { return { name: "Fifteen" }; } }, [])));
class Held { text = Blob.prototype.text; get ["constructor"]() { return { name: "Sixteen" }; } }
console.log(16, told(() => new Held().text()));
const { text } = Blob.prototype;
console.log(17, told(() => text.call(new Proxy({}, { get(target, key) { return key === "constructor" ? { name: "Seventeen" } : undefined; } }))));
console.log(18, told(() => Response.prototype.json.call({ get constructor(): unknown { throw new RangeError("Eighteen"); } } as any)));
console.log(19, told(() => Blob.prototype.text.call({ __proto__: null, [Symbol.for("nodejs.util.inspect.custom")]() { return "Nineteen"; } } as any)));
console.log(20, told(() => Blob.prototype.text.call({ __proto__: null, get shown() { return "Twenty"; } } as any)));
await Promise.resolve({ get constructor() { return { name: "TwentyOne" }; } }).then(Function.prototype.call.bind(Blob.prototype.text)).then(value => console.log(21, "answered", value), error => console.log(21, `${error?.code}: ${error?.message}`));
