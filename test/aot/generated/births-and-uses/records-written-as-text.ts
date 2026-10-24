// JSON.stringify of a record whose fields are known can be code made for that record: the names written out ahead of time, each member by its declared kind. The text must be the one that
// the general way writes, for every kind of member and whatever has become of the record since it was made.
// What the member is x how the record is written x what happened to the record before, each in some places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const members: Record<string, { type: string; value: (seed: string) => string; beside?: string }> = {
  whole: { type: "number", value: seed => `${seed}` },
  fraction: { type: "number", value: seed => `${seed} + 0.125` },
  negativeZero: { type: "number", value: () => "-0" },
  noNumber: { type: "number", value: () => "NaN" },
  infinite: { type: "number", value: () => "-Infinity" },
  large: { type: "number", value: seed => `1e21 * (${seed} + 1)` },
  tiny: { type: "number", value: () => "5e-324" },
  pastWholeNumbers: { type: "number", value: seed => `2147483647 + ${seed}` },
  text: { type: "string", value: seed => `"t" + ${seed}` },
  emptyText: { type: "string", value: () => `""` },
  textWithQuotes: { type: "string", value: () => `'a"b\\\\c/d'` },
  textWithControls: { type: "string", value: () => `"a\\n\\t\\u0001\\u007f\\u2028z"` },
  halfOfAPair: { type: "string", value: () => `"x\\ud800y\\udc00"` },
  wideText: { type: "string", value: () => `"é中😀"` },
  longText: { type: "string", value: seed => `"ab\\"".repeat(70 + ${seed})` },
  joinedText: { type: "string", value: seed => `"left" + ${seed} + "right".slice(1)` },
  truth: { type: "boolean", value: seed => `${seed} % 2 === 0` },
  none: { type: "null", value: () => "null" },
  numberOrNone: { type: "number | null", value: seed => `${seed} % 2 ? null : ${seed}` },
  nothing: { type: "undefined", value: () => "undefined" },
  numberOrNothing: { type: "number | undefined", value: seed => `${seed} % 2 ? undefined : ${seed}` },
  numberOrText: { type: "number | string", value: seed => `${seed} % 2 ? "s" : ${seed}` },
  record: { type: "{ x: number; y: string }", value: seed => `{ x: ${seed}, y: "y" }` },
  recordInARecord: { type: "{ in: { deep: number[] } }", value: seed => `{ in: { deep: [${seed}] } }` },
  emptyRecord: { type: "{}", value: () => "{}" },
  numbers: { type: "number[]", value: seed => `[${seed}, 0.5, -0, NaN]` },
  texts: { type: "string[]", value: seed => `["a", "\\"", "t" + ${seed}]` },
  records: { type: "{ x: number }[]", value: seed => `[{ x: ${seed} }, { x: 2 }]` },
  emptyList: { type: "number[]", value: () => "[]" },
  listWithAHole: { type: "(number | undefined)[]", value: seed => `[${seed}, , undefined, 3]` },
  pair: { type: "[number, string]", value: seed => `[${seed}, "p"]` },
  date: { type: "Date", value: seed => `new Date(86400000 * ${seed})` },
  bigInteger: { type: "bigint", value: () => "10n" },
  closure: { type: "() => number", value: seed => `() => ${seed}` },
  symbol: { type: "symbol", value: () => `Symbol("s")` },
  map: { type: "Map<string, number>", value: seed => `new Map([["k", ${seed}]])` },
  bytes: { type: "Uint8Array", value: seed => `new Uint8Array([${seed}, 255])` },
  wrappedNumber: { type: "Number", value: seed => `new Number(${seed})` },
  thatChangesWhatHoldsIt: { type: "Meddler", beside: "class Meddler { owner: object | null = null; how: number; constructor(how: number) { this.how = how; } toJSON(): unknown { const held = this.owner as { z?: unknown; more?: number } | null; if (held) { if (this.how % 3 === 0) delete held.z; else if (this.how % 3 === 1) held.z = 5; else held.more = 1; } return this.how; } }", value: seed => `new Meddler(${seed})` },
  thatWritesItself: { type: "{ toJSON(): unknown }", value: seed => `{ toJSON() { say("asked"); return { written: ${seed} }; } }` },
  instance: { type: "Inner", beside: "class Inner { x: number; #hidden = 1; constructor(x: number) { this.x = x; } get computed(): number { return this.x + this.#hidden; } }", value: seed => `new Inner(${seed})` },
};

const writers: Record<string, string> = {
  plainly: `say(JSON.stringify(it));`,
  indented: `say(JSON.stringify(it, null, 2));`,
  indentedByAText: `say(JSON.stringify(it, undefined, "->"));`,
  someNames: `say(JSON.stringify(it, ["m", "z"]));`,
  throughAFunction: `say(JSON.stringify(it, (key, value) => (typeof value === "number" ? value + 1 : key === "z" ? undefined : value)));`,
  inAList: `say(JSON.stringify([it, it]));`,
  inARecord: `say(JSON.stringify({ first: 1, wrapped: it, last: "l" }));`,
  theMemberAlone: `say(JSON.stringify(it.m));`,
  andReadBack: `const text = JSON.stringify(it); const back = JSON.parse(text) as { a: number; m?: unknown; z: string }; say(back.a, typeof back.m, back.z, Object.keys(back).join("+"));`,
  itsLength: `say(JSON.stringify(it).length);`,
};

const pasts: Record<string, string> = {
  asMade: "",
  aFieldWasAdded: `(it as Made & { more?: number }).more = 1;`,
  aFieldWasDeleted: `delete (it as { a?: number }).a;`,
  aFieldWasDeletedAndStoredAgain: `delete (it as { a?: number }).a; it.a = 9;`,
  itWasFrozen: `Object.freeze(it);`,
  aFieldBecameAGetter: `Object.defineProperty(it, "z", { get() { say("got z"); return "g"; }, enumerable: true });`,
  aFieldWasHidden: `Object.defineProperty(it, "z", { enumerable: false });`,
  anotherKindWasStored: `(it as { a: unknown }).a = "not a number";`,
  itWentBelowWhatWritesItself: `Object.setPrototypeOf(it, { toJSON() { return "from above"; } });`,
  itGotAWayToWriteItself: `(it as Made & { toJSON?: () => unknown }).toJSON = () => ({ own: true });`,
  itsMemberKnowsIt: `(it.m as { owner?: unknown }).owner = it;`,
  itHoldsItself: `(it as { m: unknown }).m = it;`,
};

function stretch(memberName: string, writerName: string, pastName: string): Stretch | undefined {
  const member = members[memberName];
  if (pastName === "itHoldsItself" && writerName.startsWith("indented")) return undefined;
  if (pastName === "itsMemberKnowsIt" && memberName !== "thatChangesWhatHoldsIt") return undefined;
  return {
    name: `${memberName}-${writerName}-${pastName}`,
    beside: `${member.beside ?? ""}\ntype Made = { a: number; m: ${member.type}; z: string };\nfunction make(seed: number): Made { return { a: seed, m: ${member.value("seed")}, z: "z" + seed }; }`,
    before: seed => `const start = ${seed};`,
    body: turn => `const it = make(start + (${turn})); ${pasts[pastName]} ${writers[writerName]}`,
    after: `"end"`,
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "handlerInALoop", "loopUnderAHandler", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "loopWithAYield", "loopWithAnAwait"];

export const oneIn = 140;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const member in members) for (const writer in writers) for (const past in pasts) { const made = stretch(member, writer, past); if (made) all.push(made); }
  return inEveryPlace(all, isTyped, somePlaces);
}
