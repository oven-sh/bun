const held = [Promise.try(() => 1.5), Promise.try(value => value, 2.5)];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
