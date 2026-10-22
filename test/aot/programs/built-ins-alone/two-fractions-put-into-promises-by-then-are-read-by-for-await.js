const held = [Promise.resolve().then(() => 1.5), Promise.resolve().then(() => 2.5)];
for await (const value of held) console.log(value + 1);
