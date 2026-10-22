const held = [new Promise(resolve => resolve(1.5)), new Promise(resolve => resolve(2.5))];
console.log((await held[0]) + 1, (await held[1]) + 1);
