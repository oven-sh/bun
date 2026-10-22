globalThis.__deleted = () => 1;
console.log(typeof globalThis.__deleted, delete globalThis.__deleted, typeof globalThis.__deleted);
globalThis.__deleted = 5;
console.log(globalThis.__deleted + 1, Object.keys(globalThis).includes("__deleted"));
