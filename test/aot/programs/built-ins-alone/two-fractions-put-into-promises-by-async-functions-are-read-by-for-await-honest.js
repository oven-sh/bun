const held = [(async () => 1.5)(), (async () => 2.5)()];
for await (const value of held) console.log(value + 1);
