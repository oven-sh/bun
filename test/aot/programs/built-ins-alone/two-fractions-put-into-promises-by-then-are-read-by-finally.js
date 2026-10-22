const held = [Promise.resolve().then(() => 1.5), Promise.resolve().then(() => 2.5)];
console.log((await held[0].finally(() => {})) + 1, (await held[1].finally(() => {})) + 1);
