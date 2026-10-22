const held = [Promise.resolve().then(() => 7), Promise.resolve().then(() => 1.5)];
for await (const value of held) console.log(value + 1);
