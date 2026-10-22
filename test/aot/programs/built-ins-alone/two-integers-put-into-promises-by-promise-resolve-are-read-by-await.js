const held = [Promise.resolve(7), Promise.resolve(8)];
console.log((await held[0]) + 1, (await held[1]) + 1);
