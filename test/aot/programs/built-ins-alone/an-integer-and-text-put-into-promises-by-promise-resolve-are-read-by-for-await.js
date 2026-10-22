const held = [Promise.resolve(7), Promise.resolve("text")];
for await (const value of held) console.log(typeof value, value);
