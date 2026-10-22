const held = [new Promise(resolve => resolve(Promise.resolve(7))), new Promise(resolve => resolve(Promise.resolve(1.5)))];
for await (const value of held) console.log(value + 1);
