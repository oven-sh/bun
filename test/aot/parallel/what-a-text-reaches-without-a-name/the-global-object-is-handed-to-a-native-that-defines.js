// Object.defineProperty and Object.defineProperties take the global object: Link looks through every holder below it and finds Reflect.get under the `get` that a descriptor is asked for.
Object.defineProperty(globalThis, "laidByOne", { value: 1, configurable: true });
Object.defineProperties(globalThis, { laidByMany: { value: 2, configurable: true } });
console.log(globalThis.laidByOne, globalThis.laidByMany);
