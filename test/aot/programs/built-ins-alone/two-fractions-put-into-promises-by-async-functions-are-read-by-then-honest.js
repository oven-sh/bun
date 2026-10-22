const held = [(async () => 1.5)(), (async () => 2.5)()];
await held[0].then(value => console.log(value + 1));
await held[1].then(value => console.log(value + 1));
