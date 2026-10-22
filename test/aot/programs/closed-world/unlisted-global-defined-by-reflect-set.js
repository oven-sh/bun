Reflect.set(globalThis, "__byReflectSet", () => "set");
Reflect.set(globalThis, process.env.NAME ?? "__byReflectSetComputed", () => "set under a computed key");
console.log(globalThis.__byReflectSet(), globalThis.__byReflectSetComputed());
