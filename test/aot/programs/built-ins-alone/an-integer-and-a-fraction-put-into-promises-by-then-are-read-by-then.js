const held = [Promise.resolve().then(() => 7), Promise.resolve().then(() => 1.5)];
await held[0].then(value => console.log(value + 1));
await held[1].then(value => console.log(value + 1));
