const held = [Promise.resolve("text"), Promise.resolve("more text")];
console.log((await held[0]).length, (await held[1]).length);
