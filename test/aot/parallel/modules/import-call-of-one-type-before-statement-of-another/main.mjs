// Todo: the statement is bound to its own form when the program is built
// An import() asks for a file as one type, and a graph that is loaded later holds a statement that asks for it as another type of the same kind. The loader has the first form by then and gives it to the statement.
const first = await import("./data.toml", { with: { type: "toml" } });
const later = await import("./later.mjs");
console.log(JSON.stringify(first.default), JSON.stringify(later.text));
