const held = [Promise.resolve(1.5), Promise.resolve(undefined)];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
