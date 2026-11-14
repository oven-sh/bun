// `bun run` writes the constant in place, so `import(NAME)` is `import("bun")`, which gives the Bun object and not a namespace.
const NAME = "bun";
const loaded = await import(NAME);
const written = await import("bun");
console.log(loaded === Bun, written === Bun, typeof loaded.default);
