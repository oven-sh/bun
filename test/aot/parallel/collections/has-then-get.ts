// `if (map.has(key)) .. map.get(key)`: what get() answers behind has(), on either side of the test, with and without a write in between.
const lines: string[] = [];
function show(label: string, ...values: unknown[]) {
  lines.push(label + ": " + values.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" "));
}

function cached<K, V>(cache: Map<K, V>, key: K): V | string | undefined {
  if (cache.has(key)) return cache.get(key);
  return "absent";
}

function onAbsentSide<K, V>(cache: Map<K, V>, key: K) {
  if (!cache.has(key)) return [false, cache.get(key)];
  return [true, cache.get(key)];
}

const object = {};
const keys: unknown[] = ["a", "b", "a" + "bc".slice(1), "", 0, -0, 1, 1.5, NaN, undefined, null, true, object, {}, 10n, 10n ** 30n];
const filled = new Map<unknown, unknown>();
filled.set("a", 1).set("ac", undefined).set(0, "zero").set(NaN, "nan").set(undefined, null).set(object, object).set(10n ** 30n, "big").set("", -0);

function writeBetween(map: Map<string, number>, key: string, write: (map: Map<string, number>) => void) {
  const had = map.has(key);
  write(map);
  return [had, map.get(key), map.has(key)];
}

function writeInLine(key: string) {
  const map = new Map<string, number>([[key, 1]]);
  const answers: unknown[] = [];
  if (map.has(key)) {
    map.set(key, 2);
    answers.push(map.get(key));
  }
  if (map.has(key)) {
    map.delete(key);
    answers.push(map.get(key), map.has(key));
  }
  if (!map.has(key)) {
    map.set(key, 3);
    answers.push(map.get(key), map.has(key));
  }
  if (map.has(key)) {
    map.clear();
    answers.push(map.get(key), map.has(key));
  }
  const other = new Map<string, number>([[key, 9]]);
  if (map.has(key) || other.has(key)) answers.push(map.get(key), other.get(key));
  return answers;
}

function counted(words: string[]) {
  const counts = new Map<string, number>();
  for (const word of words) {
    if (counts.has(word)) counts.set(word, counts.get(word)! + 1);
    else counts.set(word, 1);
  }
  return [...counts].join("|");
}

function lookedUpInLoop(map: Map<number, string | undefined>, upTo: number) {
  let text = "";
  for (let i = 0; i < upTo; i++) {
    if (map.has(i)) text += i + "=" + map.get(i) + ";";
  }
  return text;
}

class Doubling extends Map<string, number> {
  override get(key: string) {
    const value = super.get(key);
    return value === undefined ? -1 : value * 2;
  }
}

function weak() {
  const first = {};
  const second = {};
  const table = new WeakMap<object, unknown>([
    [first, 1],
    [second, undefined],
  ]);
  const ask = (key: object) => (table.has(key) ? ["has", table.get(key)] : ["lacks", table.get(key)]);
  show("weak", ...ask(first), ...ask(second), ...ask({}), ...ask(Symbol("s") as unknown as object), ...ask("text" as unknown as object));
  if (table.has(first)) {
    table.delete(first);
    show("weak behind delete", table.get(first), table.has(first));
  }
  if (!table.has(first)) {
    table.set(first, 2);
    show("weak behind set", table.get(first), table.has(first));
  }
}

async function acrossAwait(map: Map<string, number>) {
  const had = map.has("k");
  await null;
  return [had, map.get("k")];
}

show("cached", ...keys.map(key => cached(filled, key)));
show("either side", ...keys.map(key => onAbsentSide(filled, key).join("/")));
show("empty map", cached(new Map(), "a"), onAbsentSide(new Map(), 1).join("/"));
show("set between", ...writeBetween(new Map([["k", 1]]), "k", map => map.set("k", 2)));
show("delete between", ...writeBetween(new Map([["k", 1]]), "k", map => map.delete("k")));
show("clear between", ...writeBetween(new Map([["k", 1]]), "k", map => map.clear()));
show("added between", ...writeBetween(new Map(), "k", map => map.set("k", 7)));
show("other key between", ...writeBetween(new Map([["k", 1]]), "k", map => map.set("j", 2)));
show("in line", ...writeInLine("k"));
show("counted", counted("the cat and the dog and the bird".split(" ")));
show(
  "in a loop",
  lookedUpInLoop(
    new Map<number, string | undefined>([
      [1, "one"],
      [3, undefined],
      [40, "forty"],
    ]),
    50,
  ),
);
const doubling = new Doubling([["a", 4]]);
show("class below Map", doubling.has("a") ? doubling.get("a") : "no", doubling.has("b") ? "yes" : doubling.get("b"));
weak();
const shared = new Map([["k", 1]]);
const pending = acrossAwait(shared);
shared.set("k", 5);
show("across await", ...(await pending));
console.log(lines.join("\n"));
export {};
