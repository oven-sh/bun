const notes = [];
const told = error => "!" + error.name;
const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : typeof value === "string" ? value : String(value));
const note = value => void notes.push(show(value));
let outer = 0;
function* gen(n) {
  for (let i = 0; i < n; i++) yield () => (outer++);
}
function* second(n) {
  try {
    yield n;
    yield 2;
  } finally {
    throw new URIError("of");
  }
}
function use(it, n) {
  let turns = 0;
  for (const item of it) {
    for (const other of second(2)) {
      note([item, other]);
      if (++turns > 4) break;
    }
    if (turns > 6) break;
  }
}
try {
  const n = JSON.parse("3");
  for (let round = 0; round < 2; round++) {
      const made = gen(n);
      use(made, n);
  }
} catch (error) {
  notes.push("left" + told(error));
}
console.log(notes.join(" "));
