// Strings are looked up, stored and deleted in Maps and Sets that hold nothing else, that also hold objects, undefined, null and booleans, or that also hold numbers.
// One function gets keys of every kind, so nothing is known of its key. Another makes its key a string first, and a third a string, undefined or null.
function otherKeys(kind, count) {
  const list = [];
  for (let i = 0; i < count; i++) {
    if (kind === "objects") list.push(i % 5 === 4 ? [undefined, null, true, false][(i / 5) & 3] : { i });
    if (kind === "numbers") list.push(i % 3 === 2 ? i + 0.5 : i);
  }
  return list;
}

// The same text in other cells: joined, cut out of a longer one, parsed, and with 16 bits a character.
const spellings = [
  text => text,
  text => text.slice(0, 2) + text.slice(2),
  text => ("<" + text + ">").slice(1, -1),
  text => JSON.parse(JSON.stringify(text)),
  text => (text + "Ā").slice(0, -1),
];

function show(value) {
  return value === undefined ? "_" : typeof value === "object" && value !== null ? "{" + value.i + "}" : String(value);
}
function askWithAnyKey(map, set, key) {
  return show(map.get(key)) + (map.has(key) ? "+" : "-") + (set.has(key) ? "+" : "-");
}
function askWithText(map, set, text) {
  const key = `${text}`;
  return show(map.get(key)) + (map.has(key) ? "+" : "-") + (set.has(key) ? "+" : "-");
}
function askWithTextOrNothing(map, set, text, turn) {
  const key = turn % 3 === 0 ? `${text}` : turn % 3 === 1 ? undefined : null;
  return show(map.get(key)) + (map.has(key) ? "+" : "-") + (set.has(key) ? "+" : "-");
}
function storeWithAnyKey(map, set, key, value) {
  return map.set(key, value).size + "," + set.add(key).size;
}
function storeWithText(map, set, text, value) {
  const key = `${text}`;
  return map.set(key, value).size + "," + set.add(key).size;
}
function deleteWithAnyKey(map, set, key) {
  return (map.delete(key) ? "+" : "-") + (set.delete(key) ? "+" : "-");
}
function deleteWithText(map, set, text) {
  const key = `${text}`;
  return (map.delete(key) ? "+" : "-") + (set.delete(key) ? "+" : "-");
}

function askAll(map, set, texts, others) {
  const answers = [];
  texts.forEach((text, i) => {
    const spelled = spellings[i % spellings.length](text);
    answers.push(askWithAnyKey(map, set, spelled), askWithText(map, set, spelled));
    if (i < 12) answers.push(askWithTextOrNothing(map, set, spelled, i));
  });
  for (const other of others) answers.push(askWithAnyKey(map, set, other));
  for (const absent of ["", "key", "key-1", "0", "undefined", "[object Object]"])
    answers.push(askWithAnyKey(map, set, absent), askWithText(map, set, absent));
  for (const absent of [-1, 1e9, {}, Symbol.iterator, 7n]) answers.push(askWithAnyKey(map, set, absent));
  return answers.join(" ");
}

for (const count of [1, 4, 5, 30, 200]) {
  for (const kind of ["strings", "objects", "numbers"]) {
    const texts = [];
    for (let i = 0; i < count; i++) texts.push(i % 7 === 6 ? "clé" + i : i % 11 === 10 ? "ł" + i : "key" + i);
    const others = otherKeys(kind, count);
    const map = new Map();
    const set = new Set();
    const sizes = [];
    texts.forEach((text, i) => {
      if (i < others.length) sizes.push(storeWithAnyKey(map, set, others[i], i));
      sizes.push(i % 2 ? storeWithAnyKey(map, set, text, "v" + i) : storeWithText(map, set, text, "v" + i));
    });
    console.log(count, kind, "filled", sizes.at(-1), askAll(map, set, texts, others));

    const stored = texts.map((text, i) => {
      const spelled = spellings[(i + 1) % spellings.length](text);
      return i % 2 ? storeWithText(map, set, spelled, i) : storeWithAnyKey(map, set, spelled, i);
    });
    console.log(count, kind, "stored again", stored.at(-1), askAll(map, set, texts, others));

    const deleted = texts.map((text, i) => {
      if (i % 3 === 1) return "";
      const spelled = spellings[(i + 2) % spellings.length](text);
      return i % 3 ? deleteWithText(map, set, spelled) : deleteWithAnyKey(map, set, spelled);
    });
    console.log(count, kind, "deleted", deleted.join(""), map.size, set.size, askAll(map, set, texts, others));
    console.log(count, kind, "left", [...map.keys()].map(show).join(" "), "|", [...set].map(show).join(" "));
  }
}

// Tables that the program writes out are looked into the same two ways.
const written = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
]);
const writtenSet = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);
console.log(
  "written",
  askAll(written, writtenSet, ["one", "five", "ten", "eleven", "nine", "two"], [1, undefined, null, written]),
);
