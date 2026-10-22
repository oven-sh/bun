const held = [Promise.try(() => 1.5), Promise.try(value => value, 2.5)];
for await (const value of held) console.log(value + 1);
