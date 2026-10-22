const held = [Promise.try(() => 7), Promise.try(value => value, 1.5)];
console.log((await held[0]) + 1, (await held[1]) + 1);
