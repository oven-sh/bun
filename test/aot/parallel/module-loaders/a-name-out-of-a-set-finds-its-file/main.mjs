// Two files are named by texts that go into a Set, one through the constructor and one through add(). No string beside them spells the files, and no statement imports them.
const names = new Set(["./parts/north.mjs"]);
names.add("./parts/south.mjs");
names.add("./parts/north.mjs");
const lines = [];
for (const name of names) {
  const part = await import(name);
  lines.push(`${name}: ${part.label}, ${part.greet("the entry")}`);
}
console.log(lines.join("\n"));
console.log(names.size, names.has("./parts/south.mjs"));
