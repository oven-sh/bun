const held = [(async () => 7)(), (async () => 1.5)()];
for await (const value of held) console.log(value + 1);
