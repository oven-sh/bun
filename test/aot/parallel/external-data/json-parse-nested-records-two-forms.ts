// Records nested 4 to 1,000 levels deep, in texts of two forms that begin with the same keys and differ only behind the record inside: `JSON.parse(text) as T` gives every level of each.
type Chain = { next: Chain | null; a?: number; b?: number };
type Tree = { left: Tree | null; right: Tree | null; a?: number; b?: number };
type Owner = { pet: Pet | null; a?: number; b?: number };
type Pet = { owner: Owner | null; a?: number; b?: number };
type Rows = { rows: Rows[]; a?: number; b?: number };

type Kind = { label: string; parse: (text: string) => any; open: (level: number) => string; innermost: string; close: string; inside: (value: any) => any };
const kinds: Kind[] = [
  { label: "a chain", parse: text => JSON.parse(text) as Chain, open: () => '{"x":1,"next":', innermost: "null", close: "", inside: value => value.next },
  { label: "the left side of a tree", parse: text => JSON.parse(text) as Tree, open: () => '{"x":1,"left":', innermost: "null", close: ',"right":null', inside: value => value.left },
  { label: "the right side of a tree", parse: text => JSON.parse(text) as Tree, open: () => '{"x":1,"left":null,"right":', innermost: "null", close: "", inside: value => value.right },
  { label: "two types in turn", parse: text => JSON.parse(text) as Owner, open: level => (level % 2 ? '{"x":1,"owner":' : '{"x":1,"pet":'), innermost: "null", close: "", inside: value => ("pet" in value ? value.pet : value.owner) },
  { label: "lists of one record", parse: text => JSON.parse(text) as Rows, open: () => '{"x":1,"rows":[', innermost: "", close: "]", inside: value => value.rows[0] },
  { label: "a chain without an undeclared key", parse: text => JSON.parse(text) as Chain, open: () => '{"next":', innermost: "null", close: "", inside: value => value.next },
];

const lasts: [string, (level: number, levels: number) => string][] = [
  ["a", () => "a"],
  ["b", () => "b"],
  ["a and b in turn", level => (level % 2 ? "a" : "b")],
  ["b in the innermost alone", (level, levels) => (level === levels - 1 ? "b" : "a")],
  ["b in the outermost alone", level => (level ? "a" : "b")],
];

function textOf(kind: Kind, levels: number, last: (level: number, levels: number) => string): string {
  let text = kind.innermost;
  for (let level = levels - 1; level >= 0; level--) text = kind.open(level) + text + kind.close + ',"' + last(level, levels) + '":1}';
  return text;
}

function describe(kind: Kind, value: any): string {
  let [levels, a, b] = [0, 0, 0];
  for (; value; value = kind.inside(value)) {
    levels++;
    a += value.a ?? 0;
    b += value.b ?? 0;
  }
  return levels + "/" + a + "/" + b;
}

for (const kind of kinds) {
  // The first two forms are seen often, then come in turn at each depth. The others follow when those are through.
  for (let turn = 0; turn < 20; turn++) for (const [, last] of lasts.slice(0, 2)) describe(kind, kind.parse(textOf(kind, 2 + (turn % 3), last)));
  for (const some of [lasts.slice(0, 2), lasts.slice(2)])
    for (const levels of [4, 8, 16, 24, 32, 40, 64, 100, 1000])
      console.log(kind.label + ", " + levels + " levels: " + some.map(([label, last]) => label + " " + describe(kind, kind.parse(textOf(kind, levels, last)))).join(", "));
}
