const held = [new Promise(resolve => resolve(Promise.resolve(1.5))), new Promise(resolve => resolve(Promise.resolve(2.5)))];
console.log((await held[0].finally(() => {})) + 1, (await held[1].finally(() => {})) + 1);
