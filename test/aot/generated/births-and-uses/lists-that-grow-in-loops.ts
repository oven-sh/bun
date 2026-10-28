// A list that a loop fills. Room for all the turns may be made ahead of the loop, and the form in which the elements are kept may be chosen ahead of it: nobody may be able to tell.
// The loop may run far fewer turns than its bound says, or none; the bound may be huge, negative, a fraction, no number, or change on the way; the list may be looked at half filled,
// be known under another name, be frozen, or take elements of another kind than the first.
// Where the list comes from x how it grows x how the turns are counted, and what is put in x who looks on the way x how it grows, each in some places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type Home = { beside?: string; before: (seed: string) => string; list: string };
const homes: Record<string, Home> = {
  emptyLiteral: { before: () => `const list: Item[] = [];`, list: "list" },
  literalWithOne: { before: () => `const list: Item[] = [first];`, list: "list" },
  newArray: { before: () => `const list: Item[] = new Array<Item>();`, list: "list" },
  arrayOfALength: { before: seed => `const list: Item[] = new Array<Item>(${seed});`, list: "list" },
  arrayOf: { before: () => `const list: Item[] = Array.of<Item>();`, list: "list" },
  field: { before: () => `const holder: { list: Item[] } = { list: [] };`, list: "holder.list" },
  moduleVariable: { beside: `let list: Item[] = [];`, before: () => `list = [];`, list: "list" },
  heldByAClosure: { beside: "const readers: (() => number)[] = [];", before: () => `const list: Item[] = []; readers.push(() => list.length);`, list: "list" },
  oneOfTwo: { before: seed => `const short: Item[] = [], long: Item[] = [first, first]; const list = ${seed} % 2 ? short : long;`, list: "list" },
  copyOfAnother: { before: () => `const list: Item[] = [first, first].slice(1);`, list: "list" },
  givenFromOutside: { beside: `function given(): Item[] { return said.length > 100000 ? [first] : []; }`, before: () => `const list = given();`, list: "list" },
};

const grows: Record<string, (list: string, item: string) => string> = {
  pushes: (list, item) => `${list}.push(${item});`,
  pushesTwo: (list, item) => `${list}.push(${item}, ${item});`,
  storesAtTheEnd: (list, item) => `${list}[${list}.length] = ${item};`,
  storesAtTheCounter: (list, item) => `${list}[at] = ${item};`,
  storesAtTwiceTheCounter: (list, item) => `${list}[at * 2] = ${item};`,
  pushesOnSomeTurns: (list, item) => `if (at % 2) ${list}.push(${item});`,
  pushesAndPops: (list, item) => `${list}.push(${item}); if (at % 3 === 2) ${list}.pop();`,
  putsInFront: (list, item) => `${list}.unshift(${item});`,
  pushesASpread: (list, item) => `${list}.push(...[${item}, ${item}]);`,
  pushesInAnInnerLoop: (list, item) => `for (let inner = 0; inner < 2; inner++) ${list}.push(${item});`,
  splicesIn: (list, item) => `${list}.splice(${list}.length, 0, ${item});`,
};

type Count = { before?: string; loop: (turn: string, inner: string) => string };
const counts: Record<string, Count> = {
  toAConstant: { loop: (_, inner) => `for (let at = 0; at < 5; at++) { ${inner} }` },
  toTheTurn: { loop: (turn, inner) => `const n = (${turn}) % 4; for (let at = 0; at < n; at++) { ${inner} }` },
  down: { loop: (turn, inner) => `for (let at = (${turn}) % 4 + 1; at > 0; at--) { ${inner} }` },
  byTwo: { loop: (_, inner) => `for (let at = 0; at < 9; at += 2) { ${inner} }` },
  toTheLengthOfAnother: { loop: (turn, inner) => `const other = [1, 2, 3, ${turn}]; for (let at = 0; at < other.length; at++) { ${inner} }` },
  overAnother: { loop: (turn, inner) => `let at = 0; for (const each of [1, 2, ${turn}]) { ${inner} at += each > -1 ? 1 : 2; }` },
  overAText: { loop: (_, inner) => `let at = 0; for (const each of "a😀c") { ${inner} at += each.length; }` },
  overASet: { loop: (turn, inner) => `let at = 0; for (const each of new Set([1, 2, 1, ${turn}])) { ${inner} at += each > -1 ? 1 : 2; }` },
  hugeAndLeavesEarly: { loop: (_, inner) => `for (let at = 0; at < 4000000000; at++) { if (at > 3) break; ${inner} }` },
  hugeByAVariableAndLeavesEarly: { loop: (turn, inner) => `const n = 1e15 + (${turn}); for (let at = 0; at < n; at++) { if (at > 2) break; ${inner} }` },
  endlessAndLeaves: { loop: (_, inner) => `for (let at = 0; ; at++) { if (at > 3) break; ${inner} }` },
  toInfinityAndLeaves: { loop: (_, inner) => `const n = Infinity; for (let at = 0; at < n; at++) { if (at > 3) break; ${inner} }` },
  toANegative: { loop: (turn, inner) => `const n = -1 - (${turn}); for (let at = 0; at < n; at++) { ${inner} }` },
  toAFraction: { loop: (turn, inner) => `const n = 2.5 + (${turn}) % 2; for (let at = 0; at < n; at++) { ${inner} }` },
  toNoNumber: { loop: (_, inner) => `const n = Number("x"); for (let at = 0; at < n; at++) { ${inner} }` },
  toABoundThatShrinks: { loop: (_, inner) => `let n = 8; for (let at = 0; at < n; at++) { n--; ${inner} }` },
  toABoundThatGrows: { loop: (_, inner) => `let n = 2; for (let at = 0; at < n; at++) { if (n < 6) n++; ${inner} }` },
  toItsOwnLength: { loop: (_, inner) => `for (let at = 0; at < LIST.length + 1 && at < 6; at++) { ${inner} }` },
  whileATestHolds: { loop: (turn, inner) => `let at = 0; while (at * at < (${turn}) + 5) { ${inner} at++; }` },
  andThrowsHalfWay: { loop: (_, inner) => `for (let at = 0; at < 6; at++) { fail(at === 3); ${inner} }` },
};

const items: Record<string, { type: string; first: string; item: string }> = {
  whole: { type: "number", first: "7", item: "at + 1" },
  fractions: { type: "number", first: "0.5", item: "at + 0.25" },
  wholeThenAFraction: { type: "number", first: "7", item: "(at === 2 ? 0.5 : at)" },
  wholeThenLarge: { type: "number", first: "7", item: "(at === 2 ? 4294967296 : at)" },
  wholeThenNoNumber: { type: "number", first: "7", item: "(at === 1 ? NaN : at === 2 ? -0 : at)" },
  texts: { type: "string", first: `"f"`, item: `"t" + at` },
  objects: { type: "{ at: number }", first: "{ at: -1 }", item: "{ at }" },
  numbersThenAText: { type: "number | string", first: "7", item: `(at === 2 ? "two" : at)` },
  numbersThenNothing: { type: "number | undefined", first: "7", item: "(at === 2 ? undefined : at)" },
  lists: { type: "number[]", first: "[0]", item: "[at, at]" },
};

const lookers: Record<string, (list: string) => string> = {
  nobody: () => "",
  itsLength: list => `say(${list}.length);`,
  itsLastElement: list => `say(JSON.stringify(${list}[${list}.length - 1]));`,
  whatLiesBehindTheEnd: list => `say(${list}[${list}.length], ${list}.length in ${list}, Object.keys(${list}).length);`,
  aCopy: list => `copies.push(${list}.slice());`,
  anotherName: list => `const same = ${list}; if (at === 1) same.length = 0;`,
  aWalk: list => `let walked = 0; for (const each of ${list}) walked += each === undefined ? 10 : 1; say(walked);`,
  aFreezeOnOneTurn: list => `if (at === 2) Object.freeze(${list});`,
  itsText: list => `say(JSON.stringify(${list}));`,
  aSearch: list => `say(${list}.indexOf(first), ${list}.includes(undefined as never));`,
};

function stretch(homeName: string, growName: string, countName: string, itemName: string, lookerName: string): Stretch {
  const [home, item] = [homes[homeName], items[itemName]];
  return {
    name: `${homeName}-${growName}-${countName}-${itemName}-${lookerName}`,
    beside: `type Item = ${item.type};\nconst first: Item = ${item.first};\nconst copies: Item[][] = [];\n${home.beside ?? ""}\nfunction left(): string { const text = JSON.stringify(copies); copies.length = 0; return text; }`,
    before: home.before,
    body: turn => counts[countName].loop(turn, `${grows[growName](home.list, item.item)} ${lookers[lookerName](home.list)}`).replaceAll("LIST", home.list),
    after: `JSON.stringify(${home.list}) + ${home.list}.length + Object.keys(${home.list}).join("") + left()${homeName === "heldByAClosure" ? ` + readers[readers.length - 1]()` : ""}`,
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "loopThatStartsAnew", "twoLoopsStartedBetween", "loopWithBreak", "handlerInALoop", "loopUnderAHandler", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "loopWithAYield", "loopWithAnAwait"];

export const oneIn = 130;

export function programs(isTyped?: boolean) {
  const [itemNames, lookerNames, homeNames, countNames] = [items, lookers, homes, counts].map(Object.keys);
  const all = new Map<string, Stretch>();
  let at = 0;
  for (const home in homes) for (const grow in grows) for (const count in counts) { const made = stretch(home, grow, count, itemNames[at % itemNames.length], lookerNames[Math.floor(at++ / itemNames.length) % lookerNames.length]); all.set(made.name, made); }
  at = 0;
  for (const item in items) for (const looker in lookers) for (const grow in grows) { const made = stretch(homeNames[at % homeNames.length], grow, countNames[Math.floor(at++ / homeNames.length) % countNames.length], item, looker); all.set(made.name, made); }
  return inEveryPlace([...all.values()], isTyped, somePlaces);
}
