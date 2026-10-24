// A value typed as a host function (`typeof structuredClone`) can hold any function of the program. A call through it returns whatever that function returns.
function same(value: any) {
  return JSON.parse(JSON.stringify(value));
}
async function later(original: any) {
  await null;
  return JSON.parse(JSON.stringify(original));
}

// TypeScript reduces the three element types to `<T>(value: T) => T`, so it types the third call as an array. It returns a promise.
for (const clone of [structuredClone, same, later]) {
  const input = [1, "two", true];
  const result = clone(input);
  const cloned = await result;
  console.log(clone.name, Object.prototype.toString.call(result), cloned instanceof Array, cloned !== input, cloned.length, cloned.join());
}

function through(clone: typeof structuredClone, input: { a: number }) {
  return clone(input);
}
console.log(JSON.stringify(through(structuredClone, { a: 1 })), JSON.stringify(through(same, { a: 2 })), JSON.stringify(await through(later, { a: 3 })));

let held = structuredClone;
console.log(held("text").length);
held = later;
console.log(Object.prototype.toString.call(held("text")), (await held("text")).length);
