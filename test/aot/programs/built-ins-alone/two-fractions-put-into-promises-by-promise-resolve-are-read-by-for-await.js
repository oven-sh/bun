const held = [Promise.resolve(1.5), Promise.resolve(2.5)];
for await (const value of held) console.log(value + 1);
