globalThis.__foundByAWalk = () => "found by a walk";
const found = [];
for (const key in globalThis) if (key.startsWith("__foundBy")) found.push(globalThis[key]());
for (const [key, value] of Object.entries(globalThis)) if (key.startsWith("__foundBy")) found.push(value());
for (const key of Object.getOwnPropertyNames(globalThis)) if (key.startsWith("__foundBy")) found.push(Object.getOwnPropertyDescriptor(globalThis, key).value());
console.log(found.join());
