// A package that defines a global of its own hands `globalThis` to Object.defineProperty, which stores under its key and reads no member. That needs nothing of Bun's library.
// STATISTIC: FunctionsLowered <= 600
Object.defineProperty(globalThis, "registryOfThisProgram", { value: [], configurable: true });
Reflect.defineProperty(globalThis, "secondOfThisProgram", { get: () => 2, configurable: true });
Object.defineProperties(process, { markOfThisProgram: { value: "mark", configurable: true } });
console.log(globalThis.registryOfThisProgram.length, secondOfThisProgram, process.markOfThisProgram);
