const held = [Promise.resolve(1.5), Promise.resolve(2.5)];
console.log((await held[0]) + 1, (await held[1]) + 1);
