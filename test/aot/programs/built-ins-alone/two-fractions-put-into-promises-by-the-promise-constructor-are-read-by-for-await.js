const held = [new Promise(resolve => resolve(1.5)), new Promise(resolve => resolve(2.5))];
for await (const value of held) console.log(value + 1);
