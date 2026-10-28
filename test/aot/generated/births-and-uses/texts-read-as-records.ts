// `JSON.parse(text) as Made`: the type says what the text is expected to hold, and a reader may be made for just that. The text holds what it holds: the names in another order, one
// missing, one more, one twice, one written with an escape, a member of another kind, a number that no whole number holds, spaces everywhere, no record at all, or half a text.
// What the member is declared to be x what the text holds x how it is read x what is asked of the result, each in some places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

/** `fits` and `others` are texts of JSON for the member. */
const members: Record<string, { type: string; fits: string; others: string[] }> = {
  whole: { type: "number", fits: "7", others: [`"7"`, "null", "7.5", "-0", "1e400", "2147483648", "[7]"] },
  fraction: { type: "number", fits: "0.125", others: ["1", "1E2", "-1e-7", "true"] },
  text: { type: "string", fits: `"t"`, others: ["5", "null", `""`, `"a\\\\n\\\\u0041\\\\ud83d\\\\ude00\\\\ud800"`, `"é中😀"`, `{"length":1}`] },
  truth: { type: "boolean", fits: "true", others: ["false", "0", `"true"`, "null"] },
  none: { type: "null", fits: "null", others: ["0", "{}"] },
  numberOrNone: { type: "number | null", fits: "null", others: ["3", `"3"`, "[]"] },
  maybeANumber: { type: "number | undefined", fits: "4", others: ["null", `"x"`] },
  record: { type: "{ x: number; y: string }", fits: `{"x":1,"y":"y"}`, others: [`{"y":"y","x":1}`, `{"x":1}`, `{"x":"1","y":2}`, `{"x":1,"y":"y","w":[1]}`, "null", "[1]", `{"x":1,"x":2,"y":"y"}`, "{}"] },
  recordInARecord: { type: "{ in: { deep: number[] } }", fits: `{"in":{"deep":[1,2]}}`, others: [`{"in":{"deep":[]}}`, `{"in":{"deep":null}}`, `{"in":null}`, `{"in":{"deep":[1,"2",null]}}`] },
  numbers: { type: "number[]", fits: "[1,2,3]", others: ["[]", "[1,2.5,-0]", `[1,"2"]`, "[1,null]", "[[1]]", `{"0":1,"length":1}`, "null", "[1e400,2147483648]"] },
  texts: { type: "string[]", fits: `["a","b"]`, others: [`["a",1]`, "[]", `"ab"`] },
  records: { type: "{ x: number }[]", fits: `[{"x":1},{"x":2}]`, others: [`[{"x":1},{"y":2}]`, `[{"x":1},null]`, `[{"x":1},{"x":"2"}]`, `[{"x":1,"more":0},{"x":2}]`, "[]"] },
  pair: { type: "[number, string]", fits: `[1,"p"]`, others: [`["p",1]`, "[1]", `[1,"p",2]`] },
  oneOfTwoByATag: { type: `{ kind: "a"; n: number } | { kind: "b"; s: string }`, fits: `{"kind":"a","n":1}`, others: [`{"kind":"b","s":"s"}`, `{"kind":"b","n":1}`, `{"kind":"c"}`, `{"n":1,"kind":"a"}`, `{"kind":"a","n":1,"s":"s"}`] },
  table: { type: "Record<string, number>", fits: `{"k":1,"l":2}`, others: ["{}", `{"k":"1"}`, `{"2":2,"1":1,"k":0}`, `{"__proto__":5,"k":1}`] },
  anything: { type: "unknown", fits: "1", others: [`{"deep":{"er":[1,{"est":null}]}}`, `"s"`] },
};

/** The text of the whole record, out of the text of its member. `@` stands for a small whole number that changes from turn to turn. */
const texts: Record<string, (m: string) => string> = {
  asDeclared: m => `{"a":@,"m":${m},"z":"z@"}`,
  inAnotherOrder: m => `{"z":"z@","m":${m},"a":@}`,
  theMemberFirst: m => `{"m":${m},"a":@,"z":"z@"}`,
  withoutTheMember: () => `{"a":@,"z":"z@"}`,
  withoutTheFirst: m => `{"m":${m},"z":"z@"}`,
  withoutTheLast: m => `{"a":@,"m":${m}}`,
  withOneMoreAtTheEnd: m => `{"a":@,"m":${m},"z":"z@","more":[@]}`,
  withOneMoreInFront: m => `{"more":{"a":-1},"a":@,"m":${m},"z":"z@"}`,
  withOneMoreInTheMiddle: m => `{"a":@,"0":"zero","m":${m},"z":"z@"}`,
  theMemberTwice: m => `{"a":@,"m":null,"z":"z@","m":${m}}`,
  theFirstTwice: m => `{"a":-5,"a":@,"m":${m},"z":"z@"}`,
  aNameWithAnEscape: m => `{"\\\\u0061":@,"m":${m},"z":"z@"}`,
  aNameThatOnlyLooksAlike: m => `{"a ":@,"m":${m},"z":"z@","A":1}`,
  aNameOfThePrototype: m => `{"a":@,"__proto__":{"z":"from above","up":1},"m":${m}}`,
  spacesEverywhere: m => ` {\\n\\t"a" : @ ,\\r\\n "m" :${m} , "z"\\t: "z@" } \\n`,
  theFirstIsAFraction: m => `{"a":@.5,"m":${m},"z":"z@"}`,
  theFirstIsTooLarge: m => `{"a":@e400,"m":${m},"z":"z@"}`,
  theFirstIsAText: m => `{"a":"@","m":${m},"z":"z@"}`,
  theLastIsANumber: m => `{"a":@,"m":${m},"z":@}`,
  everythingIsNone: () => `{"a":null,"m":null,"z":null}`,
  anEmptyRecord: () => "{}",
  aList: m => `[@,${m},"z@"]`,
  none: () => "null",
  aNumber: () => "@",
  halfAText: m => `{"a":@,"m":${m},"z":"z`,
  somethingBehindTheEnd: m => `{"a":@,"m":${m},"z":"z@"} x`,
  aCommaTooMany: m => `{"a":@,"m":${m},"z":"z@",}`,
};

const ways: Record<string, { beside?: string; read: string; suspends?: "await" }> = {
  parsed: { read: "JSON.parse(text) as Made" },
  parsedIntoADeclaredVariable: { read: "JSON.parse(text)" },
  parsedByAHelper: { beside: "function readAs<T>(text: string): T { return JSON.parse(text) as T; }", read: "readAs<Made>(text)" },
  parsedByAFunctionThatSaysWhatItGives: { beside: "function readMade(text: string): Made { return JSON.parse(text); }", read: "readMade(text)" },
  parsedAsPartOfAList: { read: `(JSON.parse("[" + text + "]") as Made[])[0]` },
  parsedWithAFunction: { read: `JSON.parse(text, (key, value) => (key === "more" ? undefined : value)) as Made` },
  outOfAResponse: { read: "(await new Response(text).json()) as Made", suspends: "await" },
  outOfARequest: { read: `(await new Request("http://localhost/", { method: "POST", body: text }).json()) as Made`, suspends: "await" },
  outOfABlob: { read: "(await new Blob([text]).json()) as Made", suspends: "await" },
};

const uses: Record<string, string> = {
  readsEveryField: `say(it.a, typeof it.m, it.z);`,
  writesItBack: `say(JSON.stringify(it));`,
  listsTheKeys: `say(Object.keys(it).join("+"));`,
  reckons: `say(it.a + 1, it.z + "!", it.a * 2 > 3);`,
  asksForNames: `say("a" in it, Object.hasOwn(it, "m"), "z" in it, "up" in it);`,
  writesTheMember: `say(JSON.stringify(it.m), String(it.m));`,
  storesAgain: `it.a = 10; it.z = "again"; say(JSON.stringify(it), Object.keys(it).join("+"));`,
  copiesIt: `const copy = { ...it }; say(Object.keys(copy).join("+"), copy.a, copy.z);`,
  handsItToAReader: `say(total(it));`,
  asksWhatItIs: `say(typeof it, Array.isArray(it), it === null ? "none" : Object.getPrototypeOf(it) === Object.prototype);`,
};

function stretch(memberName: string, memberText: string, which: string, textName: string, wayName: string, useName: string): Stretch {
  const way = ways[wayName];
  return {
    name: `${memberName}-${which}-${textName}-${wayName}-${useName}`,
    beside: `type Made = { a: number; m: ${members[memberName].type}; z: string };
${way.beside ?? ""}
function total(one: Made): string { return one.a + 1 + "|" + one.z + "|" + typeof one.m; }
const pattern = "${texts[textName](memberText).replaceAll('"', '\\"')}";`,
    before: seed => `const start = ${seed};`,
    body: turn => `const text = pattern.replaceAll("@", String(start + (${turn}))); try { const it: Made = ${way.read}; ${uses[useName]} } catch (error) { say("failed", (error as Error).name); }`,
    after: `"end"`,
    suspends: way.suspends,
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "handlerInALoop", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "loopWithAYield", "loopWithAnAwait", "aroundAnAwait"];

export const oneIn = 400;

/** Dealt by the names, so that what is added to a list later leaves the other programs as they are. */
const dealt = (name: string, among: number, skip = 1): number => Number((BigInt(Bun.hash(name)) / BigInt(skip)) % BigInt(among));

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  const [wayNames, useNames, textNames] = [Object.keys(ways), Object.keys(uses), Object.keys(texts)];
  // What fits, in every text, read in every way; the uses take turns.
  for (const member in members)
    for (const text of textNames) for (const way of wayNames) all.push(stretch(member, members[member].fits, "fits", text, way, useNames[dealt(`${member}-${text}-${way}`, useNames.length)]));
  // What does not fit, in some texts, for every use; the ways take turns.
  for (const member in members)
    members[member].others.forEach((other, index) => {
      for (const text of ["asDeclared", "inAnotherOrder", "withOneMoreAtTheEnd", "spacesEverywhere"]) for (const use of useNames) all.push(stretch(member, other, `other${index}`, text, wayNames[dealt(`${member}-${index}-${text}-${use}`, wayNames.length)], use));
    });
  return inEveryPlace(all, isTyped, somePlaces);
}
