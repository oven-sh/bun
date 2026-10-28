// Something throws in a try block in front of anything that anybody could see, and the first thing its handler does is look at what the function was handed: it walks it,
// takes it apart, reads a member of it or makes something of it. What was caught is read behind that. The function is handed what its annotations say, or something else;
// it is called in one place, in several, or through a table that is read at run time. A program is one thing that throws under one form of handler, in every kind of
// function, with every first thing. It prints what it prints in plain Bun, also where a collection runs wherever one may.
import { generated } from "./generated/run-generated";

const throwers = {
  "a spread of undefined": "show(...(undefined as any));",
  "a spread of null": "show(...(null as any));",
  "a spread of what a call answers": "show(...(nothing() as any));",
  "a call of undefined": "(undefined as any)();",
  "a call of a number": "(five as any)();",
  "a construction of a number": "new (five as any)();",
  "a read on undefined": "show((undefined as any).member);",
  "a read on a field nobody set": "show((holder.missing as any).length);",
  "a pattern over null": "const { taken } = null as any; show(taken);",
  "a getter": "show(thrower.member);",
  "a binding above its declaration": "const early = () => late; show(early()); const late = 1;",
  "a thrown error": 'throw new RangeError("thrown");',
  "a thrown number": "throw 5;",
  "what the function was handed, thrown": "throw list;",
  "a callee": "fails();",
  "a built-in": 'JSON.parse("{");',
  "a bigint beside a number": "show((big as any) + 1);",
};

const everyKind = ["function", "async function", "function*", "async function*"];
const firsts: Record<string, { kinds: string[]; text: string }> = {
  "walks a set of it": { kinds: everyKind, text: "for (const element of new Set(list)) show(element);" },
  "walks a map of it": { kinds: everyKind, text: "for (const [key, value] of new Map(pairs)) show(key, value);" },
  "walks it": { kinds: everyKind, text: "for (const element of list) show(element);" },
  "walks a generator over it": { kinds: everyKind, text: "for (const element of steps(list)) show(element);" },
  "walks a text": { kinds: everyKind, text: "for (const element of text) show(element);" },
  "takes a list apart": { kinds: everyKind, text: "const [first, second] = list; show(first, second);" },
  "takes an object apart": { kinds: everyKind, text: "const { x, y } = point; show(x, y);" },
  "awaits a member": { kinds: ["async function", "async function*"], text: "show(await point.x);" },
  "awaits nothing": { kinds: ["async function", "async function*"], text: "await null; show(list.length);" },
  "yields a member": { kinds: ["function*", "async function*"], text: "yield point.x;" },
  "yields all of it": { kinds: ["function*", "async function*"], text: "yield* list;" },
  "makes an object": { kinds: everyKind, text: "const made = { x: point.x, list }; show(made.x, made.list.length);" },
  "makes a list": { kinds: everyKind, text: "const made = [point.y, list.length]; show(made.length, made[0]);" },
  "makes a closure": { kinds: everyKind, text: "const made = () => list.length + point.x; show(made());" },
  "makes an instance": { kinds: everyKind, text: "show(new Box(point).sum());" },
  "copies it": { kinds: everyKind, text: "const made = [...list]; show(made.length);" },
  "calls a function": { kinds: everyKind, text: "show(sum(list));" },
  "calls a method": { kinds: everyKind, text: 'show(list.indexOf(2), text.indexOf("b"));' },
  "reads two members": { kinds: everyKind, text: "show(point.x + point.y);" },
  "reads a length": { kinds: everyKind, text: "show(list.length);" },
  "reads an element": { kinds: everyKind, text: "show(list[0]);" },
  "reads a character": { kinds: everyKind, text: "show(text.length, text.charCodeAt(0));" },
};

const seen = "show(nameOf(error));";
const forms: Record<string, (body: string, first: string) => string> = {
  "finally": (body, first) => `try { ${body} } finally { ${first} }`,
  "catch": (body, first) => `try { ${body} } catch (error) { ${first} ${seen} }`,
  "catch that takes nothing": (body, first) => `try { ${body} } catch { ${first} }`,
  "catch that takes a pattern": (body, first) => `try { ${body} } catch ({ name }: any) { ${first} show(name); }`,
  "catch that throws on": (body, first) => `try { ${body} } catch (error) { ${first} throw error; }`,
  "catch and finally": (body, first) => `try { ${body} } catch (error) { ${first} ${seen} } finally { ${first} }`,
  "finally inside catch": (body, first) =>
    `try { try { ${body} } finally { ${first} } } catch (error) { ${first} ${seen} }`,
  "catch that throws on inside finally": (body, first) =>
    `try { try { ${body} } catch (error) { ${first} throw error; } } finally { ${first} }`,
  "finally that returns": (body, first) => `try { ${body} } finally { ${first} return "left"; }`,
  "finally that leaves a loop": (body, first) => `for (;;) { try { ${body} } finally { ${first} break; } }`,
};

const head = `function show(...values: unknown[]): void { console.log(...values); }
type Point = { x: number; y: number };
function listOf(text: string): number[] { return JSON.parse(text); }
function pointOf(text: string): Point { return JSON.parse(text); }
function textOf(text: string): string { return JSON.parse(text); }
function pairsOf(text: string): [string, number][] { return JSON.parse(text); }
function anythingOf(text: string): any { return text === "" ? undefined : JSON.parse(text); }
function nothing(): undefined { return undefined; }
function fails(): never { throw new EvalError("callee"); }
function sum(list: number[]): number { let total = 0; for (let index = 0; index < list.length; index++) total += list[index]; return total; }
function* steps(list: number[]) { yield* list; }
class Box { constructor(public point: Point) {} sum() { return this.point.x + this.point.y; } }
const holder: { missing?: number[] } = {};
const five: number = JSON.parse("5");
const big: bigint = BigInt(JSON.parse("7"));
const thrower = { get member(): number { throw new URIError("getter"); } };
function nameOf(error: unknown): unknown { return error instanceof Error ? error.name : Array.isArray(error) ? "a list of " + error.length : error; }
async function drive(name: string, made: () => any): Promise<void> {
  try {
    const result = made();
    if (result && typeof result.next === "function") {
      let step = await result.next();
      for (; !step.done; step = await result.next()) console.log(name, "yields", step.value);
      console.log(name, "returns", step.value);
    } else console.log(name, "answers", await result);
  } catch (error) {
    console.log(name, "throws", nameOf(error));
  }
}
`;

const declared = [`listOf("[1,2]")`, `pointOf('{"x":1,"y":2}')`, `textOf('"ab"')`, `pairsOf('[["a",1]]')`];
// Which argument is something else, and what.
const others: [number, string][] = [
  [0, `anythingOf('"ab"')`],
  [0, `anythingOf("")`],
  [0, `anythingOf('[1.5,"a"]')`],
  [0, `anythingOf('{"length":2,"0":1}')`],
  [1, `anythingOf('{"y":2,"x":1}')`],
  [1, `anythingOf('{"x":"a","y":"b"}')`],
  [1, `anythingOf("null")`],
  [2, `anythingOf("5")`],
  [2, `anythingOf('["a","b"]')`],
  [3, `anythingOf("")`],
  [3, `anythingOf('[[{},2]]')`],
];

function write(thrower: string, form: (body: string, first: string) => string) {
  const functions: string[] = [];
  const calls: string[] = [];
  for (const { kinds, text } of Object.values(firsts))
    for (const kind of kinds)
      for (const body of [`{ ${thrower} }`, `if (flag) { ${thrower} }`]) {
        const index = functions.length;
        const name = `f${index}`;
        functions.push(
          `${kind} ${name}(list: number[], point: Point, text: string, pairs: [string, number][], flag: boolean) { ${form(body, text)} }`,
        );
        const [position, other] = others[index % others.length];
        const callee = index % 3 === 2 ? `table[anythingOf("${index}")]` : name;
        const call = (handed: string[], flag: boolean) =>
          calls.push(`await drive("${name}", () => ${callee}(${handed.join(", ")}, ${flag}));`);
        call(declared, true);
        if (index % 3 === 0) continue;
        call(declared, false);
        call(declared.with(position, other), true);
        call(declared.with(position, other), false);
      }
  const table = `const table: ((...handed: any[]) => any)[] = [${functions.map((_, index) => `f${index}`).join(", ")}];`;
  return { file: "main.ts", text: `${head}${functions.join("\n")}\n${table}\n${calls.join("\n")}\n` };
}

const collectsWhereverItMay = {
  BUN_JSC_gcMaxHeapSize: "1",
  BUN_JSC_forceDidDeferGCWork: "1",
  BUN_JSC_useZombieMode: "1",
  BUN_JSC_scribbleFreeCells: "1",
};

const short = `function show(...values: unknown[]): void {}
function listOf(text: string): [] { return JSON.parse(text); }
async function drive(name: string, made: () => any): Promise<void> {
  try {
    const result = made();
  } catch (error) {}
  console.log(name, "ends");
}
function cleansUp(list: [], flag: boolean) { try { if (flag) show(...(undefined as any)); } finally { for (const element of new Set(list)) show; } }
drive("cleansUp", () => cleansUp(listOf("[1,2]"), true));
drive("nothing", () => 0);
`;

// Every run takes these, whatever else it takes.
const onceWrong = new Set<string>([
  "a spread of undefined under finally",
  "a thrown number under finally",
  "a thrown error under catch",
  "what the function was handed, thrown under catch",
  "a built-in under catch that throws on",
  "a callee under catch and finally",
  "a spread of null under finally inside catch",
  "a read on undefined under catch that throws on inside finally",
]);

generated("a handler begins by looking at what the function was handed as in plain Bun", [
  {
    name: "a spread of undefined under finally, in ten lines.",
    isAlwaysRun: true,
    wasOnceWrong: true,
    isOnlyCompiled: true as const,
    alsoUnder: [collectsWhereverItMay],
    make: () => ({ file: "main.ts", text: short }),
  },
  ...Object.entries(throwers).flatMap(([thrown, thrower], row) =>
    Object.entries(forms).map(([under, form], column) => ({
      name: `${thrown} under ${under}.`,
      // Every run takes one program of each form and of most things that throw; AOT_GENERATED=all takes all.
      isAlwaysRun: row % Object.keys(forms).length === column,
      wasOnceWrong: onceWrong.has(`${thrown} under ${under}`),
      isOnlyCompiled: true as const,
      alsoUnder: [collectsWhereverItMay],
      make: () => write(thrower, form),
    })),
  ),
]);
