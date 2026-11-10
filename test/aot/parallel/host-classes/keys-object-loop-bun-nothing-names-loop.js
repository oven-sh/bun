// A for-in loop over `Bun` asks whether its first key is there. Nothing in the program names that member. Then a rest pattern copies Object, and its own keys are listed. They come in the order of `bun <file>`.
for (const key in Bun) break;
const { assign, ...rest } = Object;
console.log(Reflect.ownKeys(Object).join());
