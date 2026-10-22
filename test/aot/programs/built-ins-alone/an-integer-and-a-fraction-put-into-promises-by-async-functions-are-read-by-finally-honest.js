const held = [(async () => 7)(), (async () => 1.5)()];
console.log((await held[0].finally(() => {})) + 1, (await held[1].finally(() => {})) + 1);
