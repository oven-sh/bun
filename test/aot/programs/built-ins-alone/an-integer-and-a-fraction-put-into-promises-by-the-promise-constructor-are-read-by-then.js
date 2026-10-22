const held = [new Promise(resolve => resolve(7)), new Promise(resolve => resolve(1.5))];
await held[0].then(value => console.log(value + 1));
await held[1].then(value => console.log(value + 1));
