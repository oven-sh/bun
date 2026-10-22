const held = [(async () => 7)(), (async () => 1.5)()];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
