// Bun goes into a callback, a promise or a trap, and what comes out is a value that the build does not know. Every property of it is defined on a
// new object by its descriptor, and a member of Bun is named on that object.
const copy = held => Object.defineProperties({}, Object.getOwnPropertyDescriptors(held));

async function show(road, use) {
  try {
    console.log(road, await use());
  } catch (error) {
    console.log(road, "threw", error.name);
  }
}

await show("flatMap", () => copy([1].flatMap(() => [Bun])[0]).peek(Promise.resolve(3)));
await show("Promise.try", async () => typeof new (copy(await Promise.try(() => Bun)).SQL)("postgres://127.0.0.1:1/x"));
await show("a get trap", () => copy(new Proxy({}, { get: () => Bun }).anything).$.braces("{a,b}"));
await show("a thenable", async () => {
  const held = await {
    then(resolve) {
      resolve(Bun);
    },
  };
  return typeof copy(held).sql.begin;
});
