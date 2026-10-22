const held = [Promise.resolve().then(() => Promise.resolve(7)), Promise.resolve().then(() => Promise.resolve(1.5))];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
