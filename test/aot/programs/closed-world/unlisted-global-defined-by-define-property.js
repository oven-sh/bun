let reads = 0;
Object.defineProperty(globalThis, "__byDescriptor", { get() { reads++; return () => "from the getter"; }, configurable: true });
Object.defineProperties(globalThis, { __byDescriptors: { value: () => "a value", writable: true } });
Reflect.defineProperty(globalThis, process.env.NAME ?? "__byReflect", { value: () => "by Reflect" });
console.log(globalThis.__byDescriptor(), reads, globalThis.__byDescriptors(), globalThis.__byReflect());
