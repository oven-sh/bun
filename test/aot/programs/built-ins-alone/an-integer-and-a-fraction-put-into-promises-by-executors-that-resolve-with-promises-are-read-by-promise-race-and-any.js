const held = [new Promise(resolve => resolve(Promise.resolve(7))), new Promise(resolve => resolve(Promise.resolve(1.5)))];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
