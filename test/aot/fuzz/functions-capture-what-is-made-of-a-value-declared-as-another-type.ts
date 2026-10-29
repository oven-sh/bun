// A value is declared as an interface that it may not fit. The program makes something of it (reads an element, a member, its length, adds to it, spreads it ..), and a
// function captures what was made. A program is one scene, drawn from
//   a value        what arrives: an object that fits, a list, a text, a number, undefined, null, an object of another shape, a function
//   a road         how it comes to be declared: out of a generic helper (as it is, or through a Map, a list, an optional field or a generator, where undefined may come
//                  out as well), out of JSON, by a cast, out of a field, as a parameter
//   a declaration  the interface, any, or none
//   an operation   what is made of the value
//   a capturer     an arrow function, a method or a getter of a literal, a method of a class, an arrow function inside another
//   whether the capturer is called, and by whom
//   a place        a function that runs once or twice, the top level, a static block, a function called where it is written, a loop
//   a try block round it all, or none
// One scene a program: what the compiler learns about one value says nothing about another.
import type { Random } from "./random";

const head = `function passThroughMap<V>(value: V): V {
  const map = new Map<string, V>();
  map.set("key", value);
  return map.get("key")!;
}
function passThroughList<V>(value: V): V {
  const list: V[] = [];
  list.push(value);
  return list[0]!;
}
function passThroughFind<V>(value: V): V {
  return [value].find(() => true)!;
}
function passThroughPop<V>(value: V): V {
  const list = [value];
  return list.pop()!;
}
function passThroughOptionalField<V>(value: V): V {
  const box: { held?: V } = {};
  box.held = value;
  return box.held!;
}
function passThroughGenerator<V>(value: V): V {
  function* give() {
    yield value;
  }
  return give().next().value!;
}
function pass<V>(value: V): V {
  return value;
}
function classOf(error: unknown): string {
  return "THREW " + (error as Error).constructor.name;
}
function show(label: string, value: unknown): void {
  let text: string;
  try {
    text = typeof value === "function" ? "function" : typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch (error) {
    text = classOf(error);
  }
  console.log(label, typeof value, text);
}
interface Holder {
  value: string[];
}
`;

export const values = [
  '{ value: ["a", "b"] }',
  "[undefined, undefined]",
  "[1, 2]",
  '["a", "b", "c"]',
  '"ab"',
  "7",
  "undefined",
  "null",
  "{ other: 1 }",
  "{ value: 5 }",
  "{ value: undefined }",
  "() => 1",
];

export const roads: ((value: string, declared: string) => { before?: string; held: string; parameter?: boolean })[] = [
  (value, declared) => ({ held: `passThroughMap<${declared}>((${value}) as any)` }),
  (value, declared) => ({ held: `passThroughList<${declared}>((${value}) as any)` }),
  (value, declared) => ({ held: `passThroughFind<${declared}>((${value}) as any)` }),
  (value, declared) => ({ held: `passThroughPop<${declared}>((${value}) as any)` }),
  (value, declared) => ({ held: `passThroughOptionalField<${declared}>((${value}) as any)` }),
  (value, declared) => ({ held: `passThroughGenerator<${declared}>((${value}) as any)` }),
  (value, declared) => ({ held: `pass<${declared}>((${value}) as any)` }),
  (value, declared) => ({ held: `JSON.parse(JSON.stringify([${value}]))[0] as ${declared}` }),
  (value, declared) => ({ held: `(${value}) as any as ${declared}` }),
  (value, declared) => ({
    before: `const box: { held: ${declared} } = { held: (${value}) as any };`,
    held: `box.held`,
  }),
  value => ({ held: `(${value}) as any`, parameter: true }),
];

export const declarations = ["Holder", "Holder", "any", ""];

export const operations = [
  "(held as any)[1]",
  "(held as any).length",
  "(held as any).value",
  "held.value",
  "held.value[0]",
  "held.value.length",
  "held.value.join('+')",
  "(held as any) + 1",
  "(held as any) * 2",
  "typeof held",
  "held?.value",
  "(held as any)?.[0]",
  '"value" in (held as any)',
  "`${held as any}`",
  "Object.keys(held as any)",
  "{ ...(held as any) }",
  "[held]",
  "[...(held as any)]",
  "!held",
  "held === undefined",
  "(held as any)()",
  "held",
];

// `call` is what runs the capturer, given the name it is kept under.
export const capturers: { define: string; call: string }[] = [
  { define: `const later = () => made;`, call: `later()` },
  { define: `const later = function () {\n  return made;\n};`, call: `later()` },
  { define: `const later = { read() {\n  return made;\n} };`, call: `later.read()` },
  { define: `const later = { get read() {\n  return made;\n} };`, call: `later.read` },
  { define: `class Later {\n  read() {\n    return made;\n  }\n}\nconst later = Later;`, call: `new later().read()` },
  { define: `const later = () => () => made;`, call: `later()()` },
  { define: `const later = async () => made;`, call: `await later()` },
  { define: `const later = function* () {\n  yield made;\n};`, call: `[...later()]` },
];

// Who calls: nobody, the scene itself, or whoever the scene hands the capturer to.
export const callers = ["nobody", "nobody", "scene", "outside"] as const;

export const places: ((body: string, parameter: string, argument: string) => string)[] = [
  (body, parameter, argument) => `async function scene(${parameter}) {\n${body}\n}\nawait scene(${argument});`,
  (body, parameter, argument) =>
    `async function scene(${parameter}) {\n${body}\n}\nawait scene(${argument});\nawait scene(${argument});`,
  (body, parameter, argument) => `await (async (${parameter}) => {\n${body}\n})(${argument});`,
  (body, parameter, argument) =>
    `async function scene(${parameter}) {\n${body}\n}\nfor (let turn = 0; turn < 3; turn++) await scene(${argument});`,
];
export const placesWithoutAwait: ((body: string, parameter: string, argument: string) => string)[] = [
  (body, parameter, argument) => `function scene(${parameter}) {\n${body}\n}\nscene(${argument});`,
  (body, parameter, argument) => `function scene(${parameter}) {\n${body}\n}\nscene(${argument});\nscene(${argument});`,
  (body, parameter, argument) => `((${parameter}) => {\n${body}\n})(${argument});`,
  (body, parameter, argument) =>
    parameter
      ? `function scene(${parameter}) {\n${body}\n}\nscene(${argument});`
      : `class WithBlock {\n  static {\n${body}\n  }\n}`,
  (body, parameter, argument) => (parameter ? `function scene(${parameter}) {\n${body}\n}\nscene(${argument});` : body),
];

export function generate(random: Random): string {
  const declared = random.pick(declarations);
  const road = random.pick(roads)(random.pick(values), declared || "any");
  const capturer = random.pick(capturers);
  const caller = random.pick(callers);
  const annotation = declared ? `: ${declared}` : "";
  const needsAwait = capturer.call.startsWith("await") && caller !== "nobody";
  const lines = [
    road.before,
    road.parameter ? undefined : `const held${annotation} = ${road.held};`,
    `// @ts-ignore`,
    `const made = ${random.pick(operations)};`,
    capturer.define,
    caller === "scene" && `show("read", ${capturer.call});`,
    caller === "outside" && `kept.push(later);`,
    `console.log("behind");`,
  ].filter(Boolean);
  let body = lines.join("\n");
  if (random.chance(0.6)) body = `try {\n${body}\n} catch (error) {\n  console.log("scene:", classOf(error));\n}`;
  const place = random.pick(needsAwait && caller === "scene" ? places : placesWithoutAwait);
  const scene = place(body, road.parameter ? `held${annotation || ": any"}` : "", road.parameter ? road.held : "");
  const tail =
    caller === "outside"
      ? `for (const later of kept) {\n  try {\n    show("read", ${capturer.call});\n  } catch (error) {\n    console.log("read:", classOf(error));\n  }\n}\n`
      : "";
  return `${head}const kept: any[] = [];\n${scene}\n${tail}console.log("end");\n`;
}
