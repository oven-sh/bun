// The type of an import() is known only when the program runs, and nothing else in the program asks for the file as that type. An executable holds the forms that the text of the
// program names, with --aot and without, and this one it does not name.
// Reference: bun build --compile
const options = { with: { type: globalThis.neverSet ? "text" : "toml" } };
const parsed = await import("./data.txt", options);
const text = await import("./data.txt", { with: { type: "text" } });
console.log(JSON.stringify(parsed.default), JSON.stringify(text.default));
