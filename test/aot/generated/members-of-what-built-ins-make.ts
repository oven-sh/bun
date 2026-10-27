// <this file> --names: the names of the programs, as JSON. <this file> --text <name>: one program.
// ../built-ins-alone/fresh-results-calls.ts lists calls of built-ins of Bun that make a new object, or that have native code make one and hand it to a function of the program. The script makes
// the call and takes the names that the object answers to: its own, those of the objects above it, the own names of what it holds under its own names, and the names of what a promise settles
// with or of the first thing that a list, a map or a set holds. The program makes the call too and reads each name by a member access of its own, inside a function without types, so that nothing
// but the compiler's own knowledge of the built-in says what the read finds. It prints the type of each member.
import { bodyOf, within } from "../built-ins-alone/evaluate";
import { calls } from "../built-ins-alone/fresh-results-calls";

const texts = new Map(
  Object.entries(calls).flatMap(([row, written]) =>
    written
      // An executable is given no module for tests.
      .filter(text => !text.includes("bun:internal-for-testing"))
      .map(
        (text, index) =>
          [
            `${row
              .replace(/[^A-Za-z0-9]+/g, " ")
              .trim()
              .replaceAll(" ", "-")}-${index + 1}`,
            text,
          ] as const,
      ),
  ),
);

const isIdentifier = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key);
const isObject = (value: unknown): value is object => Object(value) === value;
const symbols = Symbol as unknown as Record<string, unknown>;
const wellKnown = new Map(
  Object.getOwnPropertyNames(Symbol)
    .filter(name => typeof symbols[name] === "symbol")
    .map(name => [symbols[name] as symbol, `Symbol.${name}`]),
);
function member(object: string, key: string | symbol): string | null {
  if (typeof key === "symbol") return wellKnown.has(key) ? `${object}[${wellKnown.get(key)}]` : null;
  return isIdentifier(key) ? `${object}.${key}` : `${object}[${JSON.stringify(key)}]`;
}

function readsOf(value: unknown, name: string): string[] {
  if (!isObject(value)) return [];
  const reads: (string | null)[] = [];
  for (const key of Reflect.ownKeys(value).slice(0, 40)) {
    const read = member(name, key);
    reads.push(read);
    let held: unknown;
    try {
      held = (value as Record<PropertyKey, unknown>)[key];
    } catch {
      continue;
    }
    if (read !== null && isObject(held))
      for (const inner of Reflect.ownKeys(held).slice(0, 12)) reads.push(member(read, inner));
  }
  for (
    let above = Object.getPrototypeOf(value);
    above !== null && above !== Object.prototype && above !== Function.prototype;
    above = Object.getPrototypeOf(above)
  )
    for (const key of Reflect.ownKeys(above)) reads.push(member(name, key));
  return [...new Set(reads.filter(read => read !== null))].slice(0, 120);
}

const holds = [
  "const held =",
  "  made instanceof Promise",
  "    ? await made.catch(reason => reason)",
  "    : Array.isArray(made)",
  "      ? made[0]",
  "      : made instanceof Map || made instanceof Set",
  "        ? made.values().next().value",
  "        : undefined;",
];

const AsyncFunction = async function () {}.constructor as new (
  ...text: string[]
) => (load: unknown) => Promise<unknown>;

async function textOf(name: string): Promise<string> {
  const statements = texts.get(name)!.split("\n");
  const head = [...statements.slice(0, -1), `const made = ${statements.at(-1)};`, ...holds];
  const [made, held] = (await within<unknown>(
    new AsyncFunction("load", bodyOf([...head, "return [made, held];"].join("\n")))((module: string) =>
      require(module),
    ),
    [],
    10000,
  )) as [unknown, unknown];
  const reads = [...readsOf(made, "made"), ...readsOf(held, "held")];
  return [
    ...head,
    'const typeOf = value => (value === null ? "null" : typeof value);',
    ...reads.flatMap((read, index) => [
      `function read${index}(${read.slice(0, 4)}) {`,
      `  return ${read};`,
      "}",
      "try {",
      `  console.log(${JSON.stringify(read)}, typeOf(read${index}(${read.slice(0, 4)})));`,
      "} catch {",
      `  console.log(${JSON.stringify(read)}, "threw");`,
      "}",
    ]),
    "",
  ].join("\n");
}

if (process.argv[2] === "--names") console.log(JSON.stringify([...texts.keys()]));
else process.stdout.write(await textOf(process.argv[3]));
process.exit(0);
