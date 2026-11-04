// What is written of a value is no proof of its class: each function declares one kind of iterable and is handed every other kind, behind `as any`.
// The typed steps stand behind a test, and whatever else arrives goes by the protocol.
function show(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function ofMap(it: Map<string, number>) { let text = ""; for (const entry of it) text += show(entry) + ";"; return text; }
function ofSet(it: Set<string>) { let text = ""; for (const member of it) text += show(member) + ";"; return text; }
function ofBytes(it: Uint8Array) { let text = ""; for (const byte of it) text += show(byte) + ";"; return text; }
function ofDoubles(it: Float64Array) { let text = ""; for (const number of it) text += show(number) + ";"; return text; }
function ofText(it: string) { let text = ""; for (const piece of it) text += show(piece) + ";"; return text; }
function ofGenerator(it: Generator<string, void, unknown>) { let text = ""; for (const given of it) text += show(given) + ";"; return text; }
function ofArguments(it: IArguments) { let text = ""; for (const argument of it) text += show(argument) + ";"; return text; }
function ofList(it: string[]) { let text = ""; for (const element of it) text += show(element) + ";"; return text; }

function pairsOfMap(it: Map<string, number>) { let text = ""; for (const [key, value] of it) text += show(key) + "=" + show(value) + ";"; return text; }
function pairsOfSet(it: Set<[string, number]>) { let text = ""; for (const [first, second] of it) text += show(first) + "=" + show(second) + ";"; return text; }
function pairsOfList(it: [string, number][]) { let text = ""; for (const [first, second] of it) text += show(first) + "=" + show(second) + ";"; return text; }

function spreadOfMap(it: Map<string, number>) { return show([...it]); }
function spreadOfSet(it: Set<string>) { return show([...it]); }
function spreadOfBytes(it: Uint8Array) { return show([...it]); }
function spreadOfText(it: string) { return show([...it]); }
function spreadOfGenerator(it: Generator<string, void, unknown>) { return show([...it]); }
function spreadOfArguments(it: IArguments) { return show([...it]); }
function spreadOfList(it: string[]) { return show([...it]); }

function patternOfMap(it: Map<string, number>) { const [first, second, ...rest] = it; return show(first) + "|" + show(second) + "|" + show(rest); }
function patternOfSet(it: Set<string>) { const [first, second] = it; return show(first) + "|" + show(second); }
function patternOfBytes(it: Uint8Array) { const [first, second] = it; return show(first) + "|" + show(second); }
function patternOfText(it: string) { const [first, second] = it; return show(first) + "|" + show(second); }
function patternOfList(it: string[]) { const [first, second] = it; return show(first) + "|" + show(second); }

function* throughMap(it: Map<string, number>) { yield* it; }
function* throughSet(it: Set<string>) { yield* it; }
function* throughText(it: string) { yield* it; }
function* throughList(it: string[]) { yield* it; }
function drained(run: (it: any) => Generator<unknown>) { return (it: any) => { let text = ""; for (const given of run(it)) text += show(given) + ";"; return text; }; }

function argumentsOf(..._all: unknown[]): IArguments { return (function () { return arguments; }).apply(null, _all as any); }
function* generatorOf(...all: unknown[]) { for (let n = 0; n < all.length; n++) yield all[n]; }
class Below extends Map<string, number> { [Symbol.iterator](): any { return [["below", 1], "bw"][Symbol.iterator](); } }
class Plain extends Set<string> { }

const kinds: [string, () => unknown][] = [
  ["map", () => new Map<unknown, unknown>([["k", 1], ["lm", 2]])],
  ["set", () => new Set<unknown>(["st", ["u", 3]])],
  ["bytes", () => new Uint8Array([7, 8, 9])],
  ["doubles", () => new Float64Array([0.5, -0, NaN])],
  ["text", () => "a\u{1F600}b"],
  ["generator", () => generatorOf("gh", ["i", 4])],
  ["arguments", () => argumentsOf("ar", ["g", 5])],
  ["list", () => [["list", 4], "uv"]],
  ["holes", () => [, "hl", ,]],
  ["below", () => new Below([["hidden", 0]])],
  ["plain", () => new Plain(["pq"])],
  ["own", () => ({ [Symbol.iterator]() { let turn = 0; return { next() { turn++; return { done: turn > 2, value: turn === 1 ? "ow" : ["n", 6] }; } }; } })],
  ["keys", () => new Map([["mk", 1]]).keys()],
  ["entries", () => ["en", "tr"].entries()],
  ["null", () => null],
  ["undefined", () => undefined],
  ["number", () => 5],
  ["object", () => ({ length: 1, 0: "no" })],
];

const readers: [string, (it: any) => string][] = [
  ["ofMap", ofMap], ["ofSet", ofSet], ["ofBytes", ofBytes], ["ofDoubles", ofDoubles], ["ofText", ofText], ["ofGenerator", ofGenerator], ["ofArguments", ofArguments], ["ofList", ofList],
  ["pairsOfMap", pairsOfMap], ["pairsOfSet", pairsOfSet], ["pairsOfList", pairsOfList],
  ["spreadOfMap", spreadOfMap], ["spreadOfSet", spreadOfSet], ["spreadOfBytes", spreadOfBytes], ["spreadOfText", spreadOfText], ["spreadOfGenerator", spreadOfGenerator], ["spreadOfArguments", spreadOfArguments], ["spreadOfList", spreadOfList],
  ["patternOfMap", patternOfMap], ["patternOfSet", patternOfSet], ["patternOfBytes", patternOfBytes], ["patternOfText", patternOfText], ["patternOfList", patternOfList],
  ["throughMap", drained(throughMap)], ["throughSet", drained(throughSet)], ["throughText", drained(throughText)], ["throughList", drained(throughList)],
];

for (let round = 0; round < 3; round++) {
  for (const [name, read] of readers) {
    let line = name + ":";
    for (const [kind, make] of kinds) {
      let answer: string;
      try { answer = read(make()); } catch (error) { answer = (error as Error).name; }
      line += " " + kind + "=" + answer;
    }
    if (round !== 1) console.log(line);
  }
}
