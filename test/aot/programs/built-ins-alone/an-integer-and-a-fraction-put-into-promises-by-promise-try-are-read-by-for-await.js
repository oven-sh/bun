const held = [Promise.try(() => 7), Promise.try(value => value, 1.5)];
for await (const value of held) console.log(value + 1);
