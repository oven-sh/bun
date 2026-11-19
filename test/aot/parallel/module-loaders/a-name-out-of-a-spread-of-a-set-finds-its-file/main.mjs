// A list spreads a Set and a list and adds a text of its own. Each text is the name of a load.
const first = new Set(["./parts/north.mjs"]);
const second = ["./parts/south.mjs"];
const lines = [];
for (const name of [...first, ...second, "./parts/north.mjs"]) lines.push((await import(name)).label);
console.log(lines.join());
