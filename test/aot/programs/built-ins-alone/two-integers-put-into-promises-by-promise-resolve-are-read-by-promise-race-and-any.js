const held = [Promise.resolve(7), Promise.resolve(8)];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
