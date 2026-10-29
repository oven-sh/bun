// One class makes the objects of a union: `new Node(1) as Num`, `new Node(2) as Str`, where the interfaces below the class write one literal each for `kind`, and each maker then stores the
// fields of its own member. An object may be laid out for its member from the start, by the tag that the constructor is given. The tag may also be one that no member has, belong to
// another member than the fields that follow, come out of a variable, change later; and the constructor may run for a child, for another new.target or for an object that is there already, and answer with another object.
// How the class is written x how a member is made x what is asked of it, and what the tags are x how a member is made, each in some places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type Tags = { type: string; beside?: string; values: [string, string, string] };
const tagKinds: Record<string, Tags> = {
  numbers: { type: "number", values: ["1", "2", "9"] },
  zeroAndOne: { type: "number", values: ["0", "1", "-1"] },
  farApart: { type: "number", values: ["3", "1000000", "-5"] },
  texts: { type: "string", values: [`"num"`, `"str"`, `"other"`] },
  enumMembers: { type: "Kind", beside: "enum Kind { Num = 1, Str, Other }", values: ["Kind.Num", "Kind.Str", "Kind.Other"] },
  constEnumMembers: { type: "Kind", beside: "const enum Kind { Num = 4, Str = 8, Other = 16 }", values: ["Kind.Num", "Kind.Str", "Kind.Other"] },
  textEnumMembers: { type: "Kind", beside: `enum Kind { Num = "n", Str = "s", Other = "o" }`, values: ["Kind.Num", "Kind.Str", "Kind.Other"] },
};

type Maker = { declare: (kind: string) => string; list: (tag: string) => string };
const makers: Record<string, Maker> = {
  stores: { declare: K => `class Node { kind: ${K}; pos: number; constructor(kind: ${K}) { this.kind = kind; this.pos = 0; } }`, list: tag => tag },
  initializers: { declare: K => `class Node { kind: ${K}; pos = 3; constructor(kind: ${K}) { this.kind = kind; } }`, list: tag => tag },
  tagComesSecond: { declare: K => `class Node { pos: number; kind: ${K}; constructor(pos: number, kind: ${K}) { this.pos = pos; this.kind = kind; } }`, list: tag => `5, ${tag}` },
  parameterIsTheField: { declare: K => `class Node { pos = 1; constructor(public kind: ${K}) {} }`, list: tag => tag },
  belowAnother: { declare: K => `class Base { id = 7; }\nclass Node extends Base { kind: ${K}; pos: number; constructor(kind: ${K}) { super(); this.kind = kind; this.pos = 0; } }`, list: tag => tag },
  plainFunction: { declare: K => `interface Node { kind: ${K}; pos: number }\nfunction NodeMaker(this: Node, kind: ${K}) { this.kind = kind; this.pos = 0; }\nconst Node = NodeMaker as unknown as new (kind: ${K}) => Node;`, list: tag => tag },
  answersWithWhatItIsGiven: { declare: K => `interface Node { kind: ${K}; pos: number }\nfunction NodeMaker(this: Node, kind: ${K}, answer?: object) { this.kind = kind; this.pos = 0; if (answer) return answer; }\nconst Node = NodeMaker as unknown as new (kind: ${K}, answer?: object) => Node;`, list: tag => tag },
  withAMethod: { declare: K => `class Node { kind: ${K}; pos: number; constructor(kind: ${K}) { this.kind = kind; this.pos = 0; } describe(): string { return this.kind + ":" + this.pos; } }`, list: tag => tag },
  storesOnOneOfTwoWays: { declare: K => `class Node { kind: ${K}; pos: number; constructor(kind: ${K}, late = false) { this.pos = 0; if (late) { this.pos = 1; this.kind = kind; } else this.kind = kind; } }`, list: tag => tag },
};

type Birth = { only?: string[]; beside?: (m: Maker, t: Tags) => string; num: (m: Maker, t: Tags) => string; str?: (m: Maker, t: Tags) => string };
const births: Record<string, Birth> = {
  asWritten: { num: (m, t) => `const n = new Node(${m.list(t.values[0])}) as Num; n.value = v; return n;` },
  tagInAParameter: { beside: (m, t) => `function node(kind: ${t.type}): Node { return new Node(${m.list("kind")}); }`, num: (m, t) => `const n = node(${t.values[0]}) as Num; n.value = v; return n;`, str: (m, t) => `const n = node(${t.values[1]}) as Str; n.text = s; return n;` },
  tagOutOfAList: { beside: (m, t) => `const tags: ${t.type}[] = [${t.values.join(", ")}];`, num: m => `const n = new Node(${m.list("tags[0]")}) as Num; n.value = v; return n;`, str: m => `const n = new Node(${m.list("tags[1]")}) as Str; n.text = s; return n;` },
  fieldLeftOutNowAndThen: { num: (m, t) => `const n = new Node(${m.list(t.values[0])}) as Num; if (v % 2) n.value = v; return n;` },
  tagOfTheOtherMember: { num: (m, t) => `const n = new Node(${m.list(t.values[1])}) as unknown as Num; n.value = v; return n;` },
  tagOfNoMember: { num: (m, t) => `const n = new Node(${m.list(t.values[2])}) as unknown as Num; n.value = v; return n;` },
  tagChangedLater: { num: (m, t) => `const n = new Node(${m.list(t.values[1])}) as unknown as Num; n.value = v; (n as Node).kind = ${t.values[0]}; return n;` },
  tagChangedFirst: { num: (m, t) => `const n = new Node(${m.list(t.values[1])}); n.kind = ${t.values[0]}; const made = n as Num; made.value = v; return made;` },
  oneFieldMore: { num: (m, t) => `const n = new Node(${m.list(t.values[0])}) as Num; n.extra = v + 1; n.value = v; return n;` },
  byReflect: { num: (m, t) => `const n = Reflect.construct(Node, [${m.list(t.values[0])}]) as Num; n.value = v; return n;` },
  forAChild: { beside: () => "class Child extends Node {}", num: (m, t) => `const n = new Child(${m.list(t.values[0])}) as unknown as Num; n.value = v; return n;` },
  forAnotherNewTarget: { beside: () => "class Other { other(): string { return \"other\"; } }", num: (m, t) => `const n = Reflect.construct(Node, [${m.list(t.values[0])}], Other) as Num; n.value = v; return n;` },
  filledByAHelper: { beside: () => "function fill(n: Num, v: number): Num { n.value = v; return n; }", num: (m, t) => `return fill(new Node(${m.list(t.values[0])}) as Num, v);` },
  calledForAnObjectThatIsThere: { only: ["plainFunction", "answersWithWhatItIsGiven"], num: (m, t) => `const n = { mine: v } as unknown as Num; say(Reflect.apply(NodeMaker, n, [${m.list(t.values[0])}])); n.value = v; return n;` },
  calledForOneOfItsOwn: { only: ["plainFunction", "answersWithWhatItIsGiven"], num: (m, t) => `const n = new Node(${m.list(t.values[1])}) as unknown as Num; n.value = v; NodeMaker.call(n, ${m.list(t.values[0])}); return n;` },
  answersWithAnotherObject: { only: ["answersWithWhatItIsGiven"], num: (m, t) => `const spare = { kind: ${t.values[0]}, pos: -1, value: -v }; const n = new Node(${m.list(t.values[0])}, v % 2 ? spare : undefined) as Num; say(n === (spare as unknown)); if (n !== (spare as unknown)) n.value = v; return n;` },
  frozenBehind: { num: (m, t) => `const n = new Node(${m.list(t.values[0])}) as Num; n.value = v; return Object.freeze(n);` },
};

const uses: Record<string, (t: Tags, turn: string) => string> = {
  choosesByTheTag: t => `say(one.kind === ${t.values[0]} ? one.value : one.text);`,
  switchesOnTheTag: t => `switch (one.kind) { case ${t.values[0]}: say("num", one.value, one.pos); break; case ${t.values[1]}: say("str", one.text, one.pos); break; default: say("other"); }`,
  listsTheKeys: () => `say(Object.keys(one).join("+"));`,
  writesItAsText: () => `say(JSON.stringify(one));`,
  asksForNames: () => `say("value" in one, "text" in one, Object.hasOwn(one, "pos"));`,
  readsBothMembersFields: () => `const open = one as unknown as { value?: number; text?: string; extra?: number }; say(open.value, open.text, open.extra);`,
  walksTheKeys: () => `for (const key in one) say(key);`,
  copiesIt: () => `const copy = { ...one }; say(Object.keys(copy).join("+"), copy.kind);`,
  storesAgain: t => `if (one.kind === ${t.values[0]}) one.value += 1; else one.text += "!"; say(JSON.stringify(one));`,
  deletesAField: () => `delete (one as { value?: number }).value; say(Object.keys(one).join("+"), read(one));`,
  asksItsClass: () => `say(one instanceof Node, Object.getPrototypeOf(one) === Node.prototype, one.constructor.name);`,
  makesAnother: (t, turn) => `const fresh: Either = (${turn}) % 2 ? num(${turn}) : str("x" + (${turn})); say(read(fresh), fresh.pos, Object.keys(fresh).join("+"));`,
  changesTheTag: t => `(one as Node).kind = one.kind === ${t.values[0]} ? ${t.values[1]} : ${t.values[0]}; say(read(one), JSON.stringify(one));`,
};

function stretch(makerName: string, tagName: string, birthName: string, useName: string): Stretch {
  const [maker, tags, birth] = [makers[makerName], tagKinds[tagName], births[birthName]];
  return {
    name: `${makerName}-${tagName}-${birthName}-${useName}`,
    beside: `${tags.beside ?? ""}
${maker.declare(tags.type)}
interface Num extends Node { kind: ${tags.values[0]}; value: number; extra?: number }
interface Str extends Node { kind: ${tags.values[1]}; text: string }
type Either = Num | Str;
${birth.beside?.(maker, tags) ?? ""}
function num(v: number): Num { ${birth.num(maker, tags)} }
function str(s: string): Str { ${birth.str?.(maker, tags) ?? `const n = new Node(${maker.list(tags.values[1])}) as Str; n.text = s; return n;`} }
function read(one: Either): unknown { return one.kind === ${tags.values[0]} ? one.value : one.text; }`,
    before: seed => `const all: Either[] = [num(${seed}), str("t" + ${seed}), num(${seed} + 1), str("u")];`,
    body: turn => `const one = all[(${turn}) % all.length]; ${uses[useName](tags, turn)}`,
    after: `all.map(each => JSON.stringify(each) + read(each)).join("|")`,
  };
}

const somePlaces = ["once", "often", "loop", "loopThatStartsAnew", "twoLoops", "handlerInALoop", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "moduleLoop", "loopWithAYield", "loopWithAnAwait"];

export const oneIn = 60;

/** Dealt by the names, so that what is added to a list later leaves the other programs as they are. */
const dealt = (name: string, among: number, skip = 1): number => Number((BigInt(Bun.hash(name)) / BigInt(skip)) % BigInt(among));

export function programs(isTyped?: boolean) {
  const tagNames = Object.keys(tagKinds);
  const all = new Map<string, Stretch>();
  for (const maker in makers) for (const birth in births) for (const use in uses) { if (births[birth].only?.includes(maker) === false) continue; const made = stretch(maker, tagNames[dealt(`${maker}-${birth}-${use}`, tagNames.length)], birth, use); all.set(made.name, made); }
  for (const tag in tagKinds)
    for (const birth in births)
      for (const maker of ["stores", "plainFunction"])
        for (const use of ["switchesOnTheTag", "writesItAsText", "makesAnother"]) { if (births[birth].only?.includes(maker) === false) continue; const made = stretch(maker, tag, birth, use); all.set(made.name, made); }
  return inEveryPlace([...all.values()], isTyped, somePlaces);
}
