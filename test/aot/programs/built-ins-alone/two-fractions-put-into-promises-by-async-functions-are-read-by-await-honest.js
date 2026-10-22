const held = [(async () => 1.5)(), (async () => 2.5)()];
console.log((await held[0]) + 1, (await held[1]) + 1);
