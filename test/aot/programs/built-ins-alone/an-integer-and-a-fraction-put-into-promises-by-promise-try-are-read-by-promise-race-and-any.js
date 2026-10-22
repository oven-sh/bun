const held = [Promise.try(() => 7), Promise.try(value => value, 1.5)];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
