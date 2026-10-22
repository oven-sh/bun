const held = [Promise.resolve("text"), Promise.resolve("more text")];
for await (const value of held) console.log(value.length);
