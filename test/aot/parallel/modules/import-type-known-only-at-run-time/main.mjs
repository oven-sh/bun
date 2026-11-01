// Todo: the executable holds the forms that the program's text names, and this one it does not name
// The type of an import() is known only when the program runs, and nothing else in the program asks for the file as that type.
const options = { with: { type: globalThis.neverSet ? "text" : "toml" } };
const parsed = await import("./data.txt", options);
const text = await import("./data.txt", { with: { type: "text" } });
console.log(JSON.stringify(parsed.default), JSON.stringify(text.default), parsed === text);
