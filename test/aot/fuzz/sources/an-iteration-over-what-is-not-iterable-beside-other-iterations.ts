// An iteration over undefined, null, a number or an object without a usable @@iterator stands beside another iteration: in front of it, behind it, between two,
// inside its loop, or on one of two paths; in no try block, in one, in two, or under a finally. A program is one way to iterate over one value, in every such place
// and in every kind of function that can hold it. It prints what it prints in plain Bun.
import { family } from "../family";

const values = {
  "undefined": "undefined as any",
  "null": "null as any",
  "void 0": "(void 0) as any",
  "the answer of a call": "nothing() as any",
  "a field nobody set": "holder.missing as any",
  "a number": "5 as any",
  "an object": "({}) as any",
  "an object whose method is a number": "({ [Symbol.iterator]: 5 }) as any",
  "an object whose method answers a number": "({ [Symbol.iterator]() { return 5; } }) as any",
  "a list": 'listOf("[7,8]") as any',
};

const plain = ["function", "function*", "async function"];
const ways: Record<string, { kinds: string[]; text: (value: string) => string }> = {
  "yield*": { kinds: ["function*", "async function*"], text: value => `yield* (${value});` },
  "for..of": { kinds: plain, text: value => `for (const opened of (${value})) show(opened);` },
  "a spread in a list": { kinds: plain, text: value => `show([...(${value})]);` },
  "a spread in a call": { kinds: plain, text: value => `show(...((${value}) as [unknown]));` },
  "a pattern": { kinds: plain, text: value => `const [taken] = (${value}); show(taken);` },
  "a pattern with a rest": {
    kinds: plain,
    text: value => `const [head, ...rest] = (${value}); show(head); show(rest);`,
  },
  "for await": {
    kinds: ["async function", "async function*"],
    text: value => `for await (const opened of (${value})) show(opened);`,
  },
};

const neighbors = [
  "for (const element of list) show(element);",
  "for (const element of [1, 2]) show(element);",
  "for (const element of list) { show(element); if (element > 0) break; }",
  "for (const element of new Set(list)) show(element);",
  "for (const element of text) show(element);",
  "for (const element of anything) show(element);",
  "for (const element of list) for (const inner of list) show(element + inner);",
  "show([...list, ...list]);",
  "const [first, second] = list; show(first + second);",
  "yield* list;",
];

const caught = "catch (error) { show((error as Error).name); }";
const places: ((iteration: string, neighbor: string) => string)[] = [
  (iteration, neighbor) => `${iteration} ${neighbor}`,
  (iteration, neighbor) => `${neighbor} ${iteration}`,
  (iteration, neighbor) => `${neighbor} ${iteration} ${neighbor}`,
  (iteration, neighbor) => `for (const outer of list) { show(outer); ${iteration} ${neighbor} }`,
  (iteration, neighbor) => `if (flag) ${iteration} ${neighbor}`,
];
const handlers: ((body: string, iteration: string, neighbor: string) => string)[] = [
  body => body,
  (body, _, neighbor) => `try { ${body} } ${caught} ${neighbor}`,
  (body, iteration, neighbor) => `try { try { ${body} } ${caught} ${iteration} ${neighbor} } ${caught}`,
  body => `try { ${body} } finally { show("finally"); }`,
  (body, _, neighbor) => `try { ${body} } finally { ${neighbor} }`,
];

const head = `function show(...values: unknown[]): void { console.log(...values); }
function listOf(text: string): number[] { return JSON.parse(text); }
function nothing(): undefined { return undefined; }
const holder: { missing?: number[] } = {};
const text: string = JSON.parse('"ab"');
const anything: any = JSON.parse("[5,6]");
async function drive(name: string, made: () => any): Promise<void> {
  try {
    const result = made();
    if (result && typeof result.next === "function") {
      for (let step = await result.next(); !step.done; step = await result.next()) console.log(name, "yields", step.value);
    } else await result;
    console.log(name, "ends");
  } catch (error) {
    console.log(name, "throws", (error as Error).name);
  }
}
`;

function write(way: keyof typeof ways, value: string) {
  const functions: string[] = [];
  const calls: string[] = [];
  const iteration = `{ ${ways[way].text(value)} }`;
  for (const kind of ways[way].kinds)
    for (const statement of neighbors) {
      if (statement.startsWith("yield") && !kind.endsWith("*")) continue;
      const neighbor = `{ ${statement} }`;
      for (const place of places)
        for (const handler of handlers) {
          const name = `f${functions.length}`;
          functions.push(
            `${kind} ${name}(list: number[], flag: boolean) { ${handler(place(iteration, neighbor), iteration, neighbor)} }`,
          );
          calls.push(`await drive("${name}", () => ${name}(listOf("[1,2]"), true));`);
        }
    }
  return { file: "main.ts", text: `${head}${functions.join("\n")}\n${calls.join("\n")}\n` };
}

const neverOpens = ["undefined", "null", "void 0", "the answer of a call", "a field nobody set"];

export default family(
  "an iteration over what is not iterable stands beside other iterations as in plain Bun",
  Object.keys(ways).flatMap(way =>
    Object.entries(values).map(([name, value]) => ({
      name: `${way} over ${name}.`,
      make: () => write(way, value),
    })),
  ),
);
