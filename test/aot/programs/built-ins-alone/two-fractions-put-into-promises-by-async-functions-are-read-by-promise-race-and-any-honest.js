const held = [(async () => 1.5)(), (async () => 2.5)()];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
