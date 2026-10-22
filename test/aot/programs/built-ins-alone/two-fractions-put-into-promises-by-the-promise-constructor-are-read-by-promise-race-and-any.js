const held = [new Promise(resolve => resolve(1.5)), new Promise(resolve => resolve(2.5))];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
