const held = [Promise.resolve("text"), Promise.resolve("more text")];
await held[0].then(value => console.log(value.length));
await held[1].then(value => console.log(value.length));
