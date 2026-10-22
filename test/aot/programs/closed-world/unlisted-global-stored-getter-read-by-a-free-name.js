let reads = 0;
Object.defineProperty(globalThis, "__getterReadByAFreeName", { get() { reads++; return { deep: () => "from the getter" }; }, set(value) { reads += value; }, configurable: true });
console.log(__getterReadByAFreeName.deep(), reads);
globalThis.__getterReadByAFreeName = 10;
console.log(reads);
