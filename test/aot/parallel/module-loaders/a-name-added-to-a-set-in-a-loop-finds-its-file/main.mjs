// add() stands in a loop and behind a test: what the Set may hold does not hang on how often or in which order the texts go in.
const names = new Set();
for (let turn = 0; turn < 3; turn++) {
  if (turn % 2) names.add("./parts/south.mjs");
  else names.add("./parts/north.mjs");
}
const lines = [];
for (const name of names) lines.push((await import(name)).greet("turn " + lines.length));
console.log(lines.join("\n"));
