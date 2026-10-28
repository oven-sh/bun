// Bun comes out of a built-in beside values that the build does not know, and every property of it is defined on a new object by its descriptor.

async function show(road, use) {
  try {
    console.log(road, await use());
  } catch (error) {
    console.log(road, "threw", error.name);
  }
}

await show("concat", () =>
  Object.defineProperties({}, Object.getOwnPropertyDescriptors([].concat(Bun)[0])).peek(Promise.resolve(3)),
);
await show("Array.from", () =>
  Object.defineProperties({}, Object.getOwnPropertyDescriptors(Array.from({ length: 1 }, () => Bun)[0])).$.braces(
    "{a,b}",
  ),
);
