// `JSON.parse(text)` into types that hold themselves or each other, on texts drawn at random: one to six objects deep, with members left out, undeclared, written twice, named like an index or in another order. A round draws a few texts and parses each one to three times, in any order. `<first round> <rounds> all` as arguments prints every result.
interface Item {
  id: number;
  name: string;
  next: Item | null;
}
interface Tree {
  value: number;
  left: Tree | null;
  right: Tree | null;
}
interface Owner {
  title: string;
  pet: Pet | null;
}
interface Pet {
  kind: string;
  owner: Owner | null;
}
interface Leaf {
  id: string;
  q: string;
}
interface Mid {
  id: number;
  leaf: Leaf;
}
interface Root {
  a: number;
  b: number;
  mid: Mid;
  item: Item | null;
}

const declared = {
  Item: [
    ["id", "number"],
    ["name", "string"],
    ["next", "Item"],
  ],
  Tree: [
    ["value", "number"],
    ["left", "Tree"],
    ["right", "Tree"],
  ],
  Owner: [
    ["title", "string"],
    ["pet", "Pet"],
  ],
  Pet: [
    ["kind", "string"],
    ["owner", "Owner"],
  ],
  Leaf: [
    ["id", "string"],
    ["q", "string"],
  ],
  Mid: [
    ["id", "number"],
    ["leaf", "Leaf"],
  ],
  Root: [
    ["a", "number"],
    ["b", "number"],
    ["mid", "Mid"],
    ["item", "Item"],
  ],
} as const;
type TypeName = keyof typeof declared;
const typeNames = Object.keys(declared) as TypeName[];
const alwaysHoldsAnObject = new Set(["leaf", "mid"]);

function readItem(item: Item | null): string {
  let read = "";
  for (let steps = 0; item && steps < 8; steps++, item = item.next) read += `${item.id}/${item.name};`;
  return read;
}
function readTree(tree: Tree | null, levels = 0): string {
  return tree && levels < 8
    ? `${tree.value}(${readTree(tree.left, levels + 1)},${readTree(tree.right, levels + 1)})`
    : "";
}
function readOwner(owner: Owner | null, levels = 0): string {
  return owner && levels < 8 ? `${owner.title}>${readPet(owner.pet, levels + 1)}` : "";
}
function readPet(pet: Pet | null, levels = 0): string {
  return pet && levels < 8 ? `${pet.kind}>${readOwner(pet.owner, levels + 1)}` : "";
}
function readLeaf(leaf: Leaf): string {
  return leaf ? `${leaf.id}+${leaf.q}` : "";
}
function readMid(mid: Mid): string {
  return mid ? `${mid.id}:${readLeaf(mid.leaf)}` : "";
}
function readRoot(root: Root): string {
  return root ? `${root.a},${root.b},${readMid(root.mid)},${readItem(root.item)}` : "";
}
const one: Record<TypeName, (text: string) => string> = {
  Item: text => readItem(keep(JSON.parse(text) as Item)),
  Tree: text => readTree(keep(JSON.parse(text) as Tree)),
  Owner: text => readOwner(keep(JSON.parse(text) as Owner)),
  Pet: text => readPet(keep(JSON.parse(text) as Pet)),
  Leaf: text => readLeaf(keep(JSON.parse(text) as Leaf)),
  Mid: text => readMid(keep(JSON.parse(text) as Mid)),
  Root: text => readRoot(keep(JSON.parse(text) as Root)),
};
const many: Record<TypeName, (text: string) => string> = {
  Item: text =>
    keep(JSON.parse(text) as Item[])
      .map(item => readItem(item))
      .join(" "),
  Tree: text =>
    keep(JSON.parse(text) as Tree[])
      .map(tree => readTree(tree))
      .join(" "),
  Owner: text =>
    keep(JSON.parse(text) as Owner[])
      .map(owner => readOwner(owner))
      .join(" "),
  Pet: text =>
    keep(JSON.parse(text) as Pet[])
      .map(pet => readPet(pet))
      .join(" "),
  Leaf: text =>
    keep(JSON.parse(text) as Leaf[])
      .map(readLeaf)
      .join(" "),
  Mid: text =>
    keep(JSON.parse(text) as Mid[])
      .map(readMid)
      .join(" "),
  Root: text =>
    keep(JSON.parse(text) as Root[])
      .map(readRoot)
      .join(" "),
};
let kept: unknown;
function keep<T>(value: T): T {
  kept = value;
  return value;
}
function keysOf(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(keysOf).join(" ") + "]";
  if (value === null || typeof value !== "object") return "";
  return (
    "(" +
    Reflect.ownKeys(value)
      .map(key => String(key) + keysOf((value as Record<PropertyKey, unknown>)[key]))
      .join(",") +
    ")"
  );
}

function randomFrom(seed: number) {
  let state = seed | 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
  return {
    below: (limit: number) => next() % limit,
    oneIn: (chances: number) => next() % chances === 0,
    pick: <T>(list: readonly T[]): T => list[next() % list.length]!,
  };
}
type Random = ReturnType<typeof randomFrom>;

const letters = "abcdefghijklmnopqrstuvwxyz";
const oddNames = [
  "0",
  "7",
  "10",
  "4294967295",
  "-1",
  "__proto__",
  "constructor",
  "toString",
  "",
  " ",
  "id ",
  "next",
  "id",
  "name",
  "q",
  "leaf",
  "a name of more than thirty-two bytes in all",
];
function undeclaredName(form: Random): string {
  if (form.oneIn(8)) return form.pick(oddNames);
  if (form.oneIn(3)) return form.pick(["x", "y", "z"]);
  return letters[form.below(26)]! + letters[form.below(26)]!;
}
function scalar(values: Random): string {
  return values.pick([
    "0",
    "1",
    "-1",
    "7",
    "12345",
    "2147483648",
    "1.5",
    "-0",
    "1e3",
    '"s"',
    '""',
    '"a longer text"',
    "true",
    "false",
    "null",
  ]);
}
function anyValue(form: Random, values: Random): string {
  const kind = form.below(8);
  if (kind === 0) return `{"deep":${scalar(values)}}`;
  if (kind === 1) return `[${scalar(values)},{"in":${scalar(values)}}]`;
  if (kind === 2) return "{}";
  return scalar(values);
}

// `form` decides the names and their places, `values` what stands behind them: one form is drawn again with other values.
function objectText(type: TypeName, levels: number, form: Random, values: Random, written: string[]): string {
  const isPlain = form.oneIn(3);
  const members: string[] = [];
  for (const [name, kind] of declared[type]) {
    let value: string;
    if (kind === "number") value = values.pick(["0", "1", "7", "-3", "1000000", "2.5"]);
    else if (kind === "string") value = values.pick(['"a"', '"bc"', '""', '"some words"']);
    else if (levels > 1 || alwaysHoldsAnObject.has(name)) value = objectText(kind, levels - 1, form, values, written);
    else value = "null";
    if (!isPlain && form.oneIn(12))
      value = form.oneIn(3) ? objectText(form.pick(typeNames), 1, form, values, written) : anyValue(form, values);
    if (!isPlain && form.oneIn(12)) continue;
    members.push(`"${name}":${value}`);
    if (!isPlain && form.oneIn(16)) members.push(`"${name}":${form.oneIn(2) ? value : anyValue(form, values)}`);
  }
  if (!isPlain) {
    for (let more = form.below(4); more > 0; more--)
      members.splice(
        form.below(members.length + 1),
        0,
        `${JSON.stringify(undeclaredName(form))}:${anyValue(form, values)}`,
      );
    if (form.oneIn(5)) members.push(members.shift()!);
    if (form.oneIn(8)) members.reverse();
  }
  const space = !isPlain && form.oneIn(10) ? " " : "";
  let text = "{" + space + members.filter(member => member !== undefined).join("," + space) + space + "}";
  if (written.length && form.oneIn(10)) {
    const other = written[form.below(written.length)]!;
    if (text.length > 2 && other.length > 2)
      text = form.oneIn(2) ? other.slice(0, -1) + "," + text.slice(1) : text.slice(0, -1) + "," + other.slice(1);
  }
  written.push(text);
  return text;
}

function digest(text: string, before: number): number {
  for (let at = 0; at < text.length; at++) before = Math.imul(before ^ text.charCodeAt(at), 16777619);
  return before >>> 0;
}

const firstRound = Number(process.argv[2] ?? 1000);
const rounds = Number(process.argv[3] ?? 400);
const printsAll = process.argv[4] === "all";
for (let round = firstRound; round < firstRound + rounds; round++) {
  const random = randomFrom(round);
  const written: string[] = [];
  const favorite = random.pick(typeNames);
  const forms = Array.from({ length: 2 + random.below(4) }, () => ({
    type: random.oneIn(2) ? favorite : random.pick(typeNames),
    levels: 1 + random.below(6),
    seed: random.below(1 << 30),
    isList: random.oneIn(4),
    sameValues: random.oneIn(2),
  }));
  Bun.gc(true);
  let sum = 2166136261;
  for (let step = 8 + random.below(24); step > 0; step--) {
    const { type, levels, seed, isList, sameValues } = random.pick(forms);
    const values = randomFrom(sameValues ? seed : random.below(1 << 30));
    let text = objectText(type, levels, randomFrom(seed), values, written);
    if (isList)
      text =
        "[" +
        text +
        "," +
        objectText(type, levels, randomFrom(seed), values, written) +
        (random.oneIn(3) ? "," + random.pick(written) : "") +
        "]";
    else if (random.oneIn(12)) text = random.pick(written);
    if (written.length > 40) written.length = 40;
    if (random.oneIn(24)) Bun.gc(true);
    for (let times = 1 + random.below(3); times > 0; times--) {
      let result: string;
      kept = undefined;
      try {
        result = (isList ? many : one)[type](text);
      } catch (error) {
        result = "throws a " + (error as Error).constructor.name;
      }
      result += " " + JSON.stringify(kept) + " " + keysOf(kept);
      if (printsAll) console.log(round, type + (isList ? "[]" : ""), text, "=", result);
      sum = digest(result, sum);
    }
  }
  console.log("round", round, sum);
}
