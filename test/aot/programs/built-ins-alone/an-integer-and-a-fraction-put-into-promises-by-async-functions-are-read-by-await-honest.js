const held = [(async () => 7)(), (async () => 1.5)()];
console.log((await held[0]) + 1, (await held[1]) + 1);
