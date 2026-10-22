const held = [Promise.resolve("text"), Promise.resolve("more text")];
console.log((await Promise.race(held)).length, (await Promise.any(held)).length);
