// One constructor function makes every member of a union, by the tag it is given, and small factories cast the result and
// add the member's own fields: the way the TypeScript compiler makes its nodes. The compiler may give each tag a layout of
// its own at the `new`. Each scene uses the maker in ways that do not fit that picture too: called without `new` for an
// object that is there already, constructed for another new.target, with a tag nobody declared or one known only at run
// time, returning another object, with fields added in another order, left out, or borrowed from another member.
import type { Random } from "./random";

/** Bodies of `function Maker(this: Base, kind: number, flag?: boolean)`. */
const makers = [
  "this.kind = kind;\n  this.pos = 0;",
  "this.kind = kind;\n  this.pos = 0;\n  if (flag) return spare;",
  "this.pos = 0;\n  this.kind = kind;",
  "this.kind = kind;\n  this.pos = made++;",
  "this.kind = kind;\n  this.pos = 0;\n  if (flag) (this as any).flagged = true;",
  "this.kind = kind;\n  this.pos = new.target === undefined ? -1 : 0;",
  "this.kind = flag ? 2 : kind;\n  this.pos = 0;",
  'this.kind = kind;\n  this.pos = 0;\n  if (kind === 2) (this as any).text = "from the maker";',
];

/** Expressions that use the maker and the factories. Each is printed through `shown`. */
const uses = [
  "num(1)",
  'str("s")',
  'pair(num(1), str("t"))',
  "read(num(2))",
  'read(str("u"))',
  "read(pair(num(3), num(4)))",
  "new Node(1)",
  "new Node(2)",
  "new Node(9)",
  "new Node(hidden(1))",
  "new Node(hidden(2))",
  "new Node(1, true)",
  "new Node(2, true) === spare",
  "(Maker as any).call(handed, 2)",
  "((Maker as any).call(handed, 1), handed)",
  "(Maker as any).call(num(5), 2)",
  "((made: any) => ((Maker as any).call(made, 2), read(made)))(num(6))",
  "Reflect.construct(Maker, [1], Other)",
  "Reflect.construct(Maker, [2], Other) instanceof Other",
  "Reflect.construct(Maker, [1]) instanceof Node",
  "new Below(1)",
  "read(new Below(2) as any)",
  "told(() => (Maker as any)(1))",
  "read(new Node(1) as any)",
  "read(new Node(2) as any)",
  "read(retagged(num(7)))",
  'read(retagged(str("v")))',
  "read(borrowed(1))",
  "read(backwards(8))",
  "[1, 2, 3].map(kind => new Node(kind))",
  '[num(1), str("w"), num(2)].map(read).join()',
  "Object.getPrototypeOf(num(1)) === Maker.prototype",
  "(num(1) as any).describe()",
  'JSON.stringify(pair(num(1), str("x")))',
  'Object.keys(str("y")).join()',
];

export function generate(random: Random): string {
  const picked = random.sample(uses, random.between(5, 12));
  const rounds = random.pick([1, 1, 3, 300]);
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set<string>();
function noted(answer: string): string {
  rounds.add(answer);
  return answer;
}
function counted(): string {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
interface Base {
  kind: number;
  pos: number;
}
interface Num extends Base {
  kind: 1;
  value: number;
}
interface Str extends Base {
  kind: 2;
  text: string;
}
interface Pair extends Base {
  kind: 3;
  left: Member;
  right: Member;
}
type Member = Num | Str | Pair;
const hidden = (kind: number): number => Number(process.argv[9] ?? kind);
const spare = { kind: 1, pos: -1, value: -1, spare: true };
let handed: any = { mine: 1 };
let made = 0;
function Maker(this: Base, kind: number, flag?: boolean) {
  ${random.pick(makers)}
}
Maker.prototype.describe = function (this: Base) {
  return "kind " + this.kind;
};
const Node = Maker as unknown as new (kind: number, flag?: boolean) => Base;
function Other() {}
Other.prototype = { other: true };
class Below extends Node {
  below = true;
}
function num(value: number): Num {
  const made = new Node(1) as Num;
  made.value = value;
  return made;
}
function str(text: string): Str {
  const made = new Node(2) as Str;
  made.text = text;
  return made;
}
function pair(left: Member, right: Member): Pair {
  const made = new Node(3) as Pair;
  ${random.pick(["made.left = left;\n  made.right = right;", "made.right = right;\n  made.left = left;"])}
  return made;
}
function retagged(member: Member): Member {
  (member as any).kind = member.kind === 1 ? 2 : 1;
  return member;
}
function borrowed(value: number): Member {
  const made = new Node(1) as any;
  made.text = "borrowed";
  made.value = value;
  return made;
}
function backwards(value: number): Member {
  const made = new Node(1) as any;
  made.extra = true;
  made.value = value;
  delete made.pos;
  return made;
}
function read(one: Member): string {
  switch (one.kind) {
    case 1:
      return "num " + one.value;
    case 2:
      return "str " + one.text;
    case 3:
      return "pair " + read(one.left) + " " + read(one.right);
  }
  return "none of them";
}
function shown(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return "[" + value.map(each => shown(each, depth + 1)).join() + "]";
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 2) return "deep";
  return "{" + Object.keys(value).map(name => name + ":" + shown((value as Record<string, unknown>)[name], depth + 1)).join() + "}";
}
function told(ask: () => unknown): unknown {
  try {
    return ask();
  } catch (error) {
    return "threw " + (error as Error).name;
  }
}
let last = "";
for (let round = 0; round < ${rounds}; round++) {
  handed = { mine: 1 };
  made = 0;
  last = noted([
    ${picked.map(use => `shown(told(() => ${use}))`).join(",\n    ")},
  ].join("\\n"));
}
console.log(last, counted());
`;
}
