const held = [Promise.resolve().then(() => Promise.resolve(7)), Promise.resolve().then(() => Promise.resolve(1.5))];
console.log((await held[0]) + 1, (await held[1]) + 1);
