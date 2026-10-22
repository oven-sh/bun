const held = [Promise.resolve(1.5), Promise.resolve(undefined)];
for await (const value of held) console.log(typeof value, value);
