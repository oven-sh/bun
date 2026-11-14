// A test that finds no key, a store behind it and a read behind both: the read takes the place of the test where it found the key.
function counted(table: Map<unknown, number>, keys: unknown[]): string {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!table.has(key)) table.set(key, i * 10);
    sum += table.get(key)!;
  }
  return sum + " of " + table.size;
}
function storedOnEitherSide(table: Map<unknown, number>, keys: unknown[]): string {
  let sum = 0;
  for (const key of keys) {
    if (table.has(key)) table.set(key, table.get(key)! + 1);
    else table.set(key, 1);
    sum = sum * 3 + table.get(key)!;
  }
  return sum + " of " + table.size;
}
function deletedBetween(table: Map<unknown, number>, keys: unknown[]): string {
  let text = "";
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!table.has(key)) table.set(key, i);
    if (i % 3 === 2) table.delete(key);
    text += table.get(key) + " ";
  }
  return text + table.size;
}
function otherKeyStored(table: Map<unknown, number>, keys: unknown[]): string {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!table.has(key)) {
      table.set(keys[(i + 1) % keys.length]!, -i);
      table.set(key, i);
    }
    sum += table.get(key)! * (i + 1);
  }
  return sum + " of " + table.size;
}
function askedAgain(table: Map<unknown, number>, keys: unknown[]): string {
  let text = "";
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!table.has(key)) table.set(key, i);
    text += (table.has(key) ? table.get(key) : "lost") + " ";
  }
  return text + table.size;
}
const texts = (n: number) => Array.from({ length: 24 }, (_, i) => "key" + ((i * 7) % n) + "x".repeat(i % 3));
const kinds: Record<string, unknown[]> = {
  integers: JSON.parse("[1,2,3,1,2,9,4,4,1,7,3,9,12,1,5]"),
  fractions: JSON.parse("[0.5,-0,0,1e300,0.5,null,0,-0,2.25]").map((x: number | null) => (x === null ? NaN : x)),
  texts: texts(5),
  built: texts(9).map(text => text.slice(1) + text.length),
  mixed: [1, "1", true, null, undefined, 1n, 10n ** 20n, 10n ** 20n, "", 0, -0, NaN, NaN, "1", Symbol.iterator, Symbol.iterator],
  objects: (() => {
    const a: object = {},
      b: unknown[] = [];
    return [a, b, a, counted, b, counted, a];
  })(),
};
for (let turn = 0; turn < 3; turn++)
  for (const kind in kinds)
    for (const run of [counted, storedOnEitherSide, deletedBetween, otherKeyStored, askedAgain]) {
      const table = new Map<unknown, number>(turn ? [[1, 100], ["key1", 7], [NaN, 3]] : []);
      console.log(kind, run.name, run(table, kinds[kind]!), run(table, kinds[kind]!), [...table.values()].join());
    }
