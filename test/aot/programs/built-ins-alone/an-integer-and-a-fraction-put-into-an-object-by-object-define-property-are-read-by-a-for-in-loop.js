const held = {};
Object.defineProperty(held, "a", { value: 7, enumerable: true });
Object.defineProperty(held, "b", { value: 1.5, enumerable: true });
for (const key in held) console.log(key, held[key] + 1);
