const held = [Promise.resolve().then(() => 7), Promise.resolve().then(() => 1.5)];
console.log((await held[0].finally(() => {})) + 1, (await held[1].finally(() => {})) + 1);
