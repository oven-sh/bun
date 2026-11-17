// The type of an import() is known only when the program runs, and nothing else in the program asks for the file as that type. The path is written, so the executable holds the file under every type
// that reads text as data.
const options = { with: { type: globalThis.neverSet ? "text" : "toml" } };
const parsed = await import("./data.txt", options);
const text = await import("./data.txt", { with: { type: "text" } });
console.log(JSON.stringify(parsed.default), JSON.stringify(text.default));
