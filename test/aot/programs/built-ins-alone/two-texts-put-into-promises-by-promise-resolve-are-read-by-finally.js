const held = [Promise.resolve("text"), Promise.resolve("more text")];
console.log((await held[0].finally(() => {})).length, (await held[1].finally(() => {})).length);
