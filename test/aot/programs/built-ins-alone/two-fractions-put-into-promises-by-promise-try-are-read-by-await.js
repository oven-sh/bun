const held = [Promise.try(() => 1.5), Promise.try(value => value, 2.5)];
console.log((await held[0]) + 1, (await held[1]) + 1);
