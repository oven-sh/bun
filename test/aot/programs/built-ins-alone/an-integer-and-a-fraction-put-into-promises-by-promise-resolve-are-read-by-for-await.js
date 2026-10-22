const held = [Promise.resolve(7), Promise.resolve(1.5)];
for await (const value of held) console.log(value + 1);
