function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

interface Tree {
  value: number;
  children: Tree[];
}

function sumTree(t: Tree): number {
  let sum = t.value;
  for (let i = 0; i < t.children.length; i++) sum += sumTree(t.children[i]);
  return sum;
}

function depth(t: Tree): number {
  let deepest = 0;
  for (const child of t.children) deepest = Math.max(deepest, depth(child));
  return deepest + 1;
}

function values(t: Tree, into: number[] = []): number[] {
  into.push(t.value);
  t.children.forEach(child => values(child, into));
  return into;
}

function doubled(t: Tree): Tree {
  return { value: t.value * 2, children: t.children.map(doubled) };
}

interface Link {
  n: number;
  next: Link | null;
}

function sumLinks(l: Link | null): number {
  let sum = 0;
  while (l !== null) {
    sum += l.n;
    l = l.next;
  }
  return sum;
}

function leaf(value: number): Tree {
  return { value, children: [] };
}

function honest(label: string): void {
  const t: Tree = { value: 1, children: [leaf(2), { value: 3, children: [leaf(4)] }] };
  console.log(label, sumTree(t), depth(t), show(values(t)), JSON.stringify(doubled(t)), sumLinks({ n: 1, next: { n: 2, next: null } }));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sumTree({ value: i, children: [leaf(1), leaf(2)] }) + depth(leaf(i)) + sumLinks({ n: i, next: null });
console.log("2000 honest rounds", warm);

const trees = [
  '{"value":1,"children":[{"value":2,"children":[]}]}',
  '{"children":[{"children":[],"value":2}],"value":1}',
  '{"value":1,"children":[{"value":"2","children":[]}]}',
  '{"value":1,"children":[{"value":2}]}',
  '{"value":1,"children":[{"value":2,"children":null}]}',
  '{"value":1,"children":[null]}',
  '{"value":1,"children":[5]}',
  '{"value":1,"children":["text"]}',
  '{"value":1,"children":[[]]}',
  '{"value":1,"children":{"length":1,"0":{"value":2,"children":[]}}}',
  '{"value":1,"children":"ab"}',
  '{"value":1,"children":[{"value":2,"children":[{"value":null,"children":[]}]}]}',
  '{"value":1,"children":[{"value":2,"children":[]},{"value":2.5,"children":[]},{"value":-0,"children":[]}]}',
  '{"value":1,"children":[{"value":2,"children":[],"extra":true}]}',
  '{"value":-0,"children":[]}',
  "{}",
  "null",
];

for (const text of trees) {
  attempt("sumTree " + text, () => sumTree(JSON.parse(text)));
  attempt("depth " + text, () => depth(JSON.parse(text)));
  attempt("values " + text, () => values(JSON.parse(text)));
  attempt("doubled " + text, () => JSON.stringify(doubled(JSON.parse(text))));
}

attempt("an honest tree with one impostor grafted deep", () => {
  const t: Tree = { value: 1, children: [leaf(2), { value: 3, children: [leaf(4)] }] };
  t.children[1].children.push(hidden("{ value: 'five', children: [] }"));
  return [sumTree(t), depth(t), values(t)];
});
attempt("a child that is a getter", () => {
  const t: Tree = { value: 1, children: [] };
  t.children = hidden("Object.defineProperty([], 0, { get() { note('get-child'); return { value: 9, children: [] }; }, enumerable: true })");
  return [sumTree(t), depth(t)];
});
attempt("children that are a subclass with its own iterator", () => {
  const t: Tree = { value: 1, children: hidden("new (class extends Array { *[Symbol.iterator]() { yield { value: 100, children: [] }; } })({ value: 2, children: [] }, { value: 3, children: [] })") };
  return [sumTree(t), depth(t), values(t)];
});

for (const text of ['{"n":1,"next":{"n":2,"next":null}}', '{"n":1,"next":{"n":"2","next":null}}', '{"n":1}', '{"n":1,"next":{"n":2}}', '{"n":1,"next":0}', '{"n":1,"next":"text"}', "5", '""', "null"]) {
  attempt("sumLinks " + text, () => sumLinks(JSON.parse(text)));
}

honest("honest after");
