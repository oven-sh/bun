const held = {};
Object.defineProperty(held, "a", { value: 1.5, enumerable: true });
Object.defineProperty(held, "b", { value: 2.5, enumerable: true });
for (const key in held) console.log(key, held[key] + 1);
