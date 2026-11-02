// Eight error messages that quote no source are worded differently.
const cases = {
  "for await over an object": async () => { for await (const x of {}) { } },
  "spread of null": () => [...null],
  "spread, the iterator is no object": () => [...{ [Symbol.iterator]() { return 5; } }],
  "spread, the result is no object": () => [...{ [Symbol.iterator]() { return { next() { return 5; } }; } }],
  "Object.fromEntries of null": () => Object.fromEntries(null),
  "typed array, length over 2 ** 53": () => new Int8Array(2 ** 53),
  "typed array, negative length": () => new Int8Array(-1),
  "typed array, huge length": () => new Int8Array(1e300),
};
for (const [name, run] of Object.entries(cases)) {
  try { await run(); console.log(name, "| nothing thrown"); } catch (error) { console.log(name, "|", String(error)); }
}
