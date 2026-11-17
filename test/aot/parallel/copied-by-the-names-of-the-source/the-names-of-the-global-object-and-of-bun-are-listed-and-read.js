// The same for the global object and for Bun, handed in as values that nobody knows.
function find(source, wanted) {
  for (const key in source) if (key === wanted) return source[key];
}
const held = [JSON.parse("{}"), globalThis, Bun];
console.log(typeof find(held[1], "fetch"), typeof find(held[2], "inspect"), find(held[2], "inspect")({ made: "up" }));
