// Small programs of scenes about one shape: `test ? { key: value } : {}`. It is spread into a larger literal, alone or several times, nested (`a ? { .. } : b ? { _: undefined } : {}`), returned, kept in a constant,
// or given to a call. The test is a call of a function that nobody knows, a test of a length, a member of an object that nobody knows, or a test of the platform that a build can decide. The value is a constant,
// `true as const`, or a list that nobody knows. A scene is a function, an arrow, a method, an async function, or stands behind an await, and runs for several turns. Each turn prints what came of it, seen in several ways.
// What nobody knows has come back from `new Function("value", process.argv[9] ?? "return value")`.
import { Random } from "./random";

const typed = (text: string, isTyped: boolean) => text.replace(/@\{((?:[^{}]|\{[^{}]*\})*)\}/g, isTyped ? "$1" : "");

/** In terms of `turn`, a number that goes up, and of what the head below declares. */
const tests = [
  "isEven(turn)",
  "isThird(turn)",
  "never()",
  "always()",
  "list.length > turn",
  "text.length > 2",
  "rest.length",
  "options.verbose",
  "options.level > turn",
  "options.missing",
  "options.inner?.on",
  'process.platform === "win32"',
  'process.platform !== "win32"',
  'typeof Bun !== "undefined"',
  'typeof window !== "undefined"',
  "turn % 2 === 0",
  "turn > 1 && isEven(turn)",
  "!options.verbose",
];

const values = [
  "1",
  "turn",
  '"text"',
  "null",
  "undefined",
  "true@{ as const}",
  "false@{ as const}",
  '"on"@{ as const}',
  "list",
  "launder([turn, 2])",
  "[turn]",
  "{ deep: turn }",
  "options",
  "() => turn",
  "0.5",
  "text",
];

const keys = ["flag", "key", "a", "b", "list", "name", "_", "length", "0", "then", "toString"];

/** What is made of O, the object that came of the shape. */
const looks = [
  "JSON.stringify($O)",
  "Object.keys($O).join()",
  "Object.entries($O).length",
  '"$K" in $O',
  'Object.hasOwn($O, "$K")',
  'typeof $O["$K"]',
  "JSON.stringify({ ...$O })",
  'JSON.stringify({ ...$O, "$K": 9 })',
  'JSON.stringify({ "$K": 9, ...$O })',
  "JSON.stringify(Object.assign({ first: 0 }, $O))",
  "(() => { const seen@{: string[]} = []; for (const name in $O) seen.push(name); return seen.join(); })()",
  "JSON.stringify(launder($O))",
  "Object.getOwnPropertyNames($O).length",
  '(({ "$K": taken, ...others }@{: Loose}) => typeof taken + JSON.stringify(others))($O)',
];

export function generate(random: Random, isTyped = random.chance(0.5)): string {
  // To TypeScript `{}` has a `toString` already, of another type.
  const names = isTyped ? keys.filter(name => name !== "toString") : keys;
  const key = () => random.pick(names);
  // Nor does it know a `window` where no library declares one.
  const asked = isTyped ? tests.filter(test => !test.includes("window")) : tests;
  const named = (name: string) => (/^\d|^_$/.test(name) || /^[a-z]+$/i.test(name) ? name : JSON.stringify(name));
  const part = (name = key()) =>
    `${random.pick(asked)} ? { ${named(name)}: ${random.pick(values)}${random.chance(0.2) ? `, ${named(random.pick(names.filter(other => other !== name)))}: ${random.pick(values)}` : ""} } : {}`;
  const nested = (name = key()) =>
    `${random.pick(asked)} ? { ${named(name)}: ${random.pick(values)} } : ${random.pick(asked)} ? { _: undefined } : {}`;
  const one = (name?: string) => (random.chance(0.25) ? nested(name) : part(name));
  const scenes: string[] = [];
  const count = random.between(4, 9);
  for (let n = 0; n < count; n++) {
    const name = key();
    // What stands for O, with what has to stand in front of it.
    const [before, made] = random.pick<() => [string, string]>([
      () => ["", `{ ...base, ...(${one(name)}) }`],
      () => ["", `{ first: turn, ...(${one(name)}), ...(${one()}), last: 2 }`],
      () => ["", `{ ...(${one(name)}), ...(${one()}), ...(${one()}) }`],
      () => ["", `{ ...base, ...(${one(name)}), ${named(name)}: 7 }`],
      () => ["", `(${one(name)})`],
      () => [`const kept = ${one(name)};`, "kept"],
      () => [`const kept = ${one(name)}; const wider = { ...kept, ...(${one()}) };`, "wider"],
      () => [`const choose = ()@{: Loose} => { return ${one(name)}; };`, "choose()"],
      () => [`const choose = ()@{: Loose} => (${one(name)});`, "{ ...choose(), ...choose() }"],
      () => ["", `same(${one(name)})`],
      () => ["", `launder(${one(name)})`],
      () => ["", `Object.assign({}, ${one(name)}, ${one()})`],
      () => ["", `Object.assign({ ...base }, ${one(name)})`],
      () => ["", `[${one(name)}, ${one()}][turn % 2]`],
      () => ["", `{ inner: { ...(${one(name)}) }, ...(${one()}) }.inner`],
    ])();
    const shown = random
      .sample(looks, random.between(1, 3))
      .map(look => look.replaceAll("$O", "made").replaceAll("$K", name));
    const body = `${before ? before + " " : ""}const made@{: Loose} = ${made}; return [${shown.join(", ")}].join(" ");`;
    const rest = "...rest@{: number[]}";
    const [declared, call] = random.pick<() => [string, string]>([
      () => [`function scene${n}(turn@{: number}, ${rest})@{: string} { ${body} }`, `scene${n}(turn, turn)`],
      () => [`const scene${n} = (turn@{: number}, ${rest})@{: string} => { ${body} };`, `scene${n}(turn)`],
      () => [
        `const holder${n} = { scene(turn@{: number}, ${rest})@{: string} { ${body} } };`,
        `holder${n}.scene(turn, 1, 2)`,
      ],
      () => [
        `class Holder${n} { scene(turn@{: number}, ${rest})@{: string} { ${body} } }`,
        `new Holder${n}().scene(turn)`,
      ],
      () => [
        `async function scene${n}(turn@{: number}, ${rest})@{: Promise<string>} { ${body} }`,
        `await scene${n}(turn, turn)`,
      ],
      () => [
        `async function scene${n}(turn@{: number}, ${rest})@{: Promise<string>} { await null; ${body} }`,
        `await scene${n}(turn)`,
      ],
      () => [
        `async function scene${n}(turn@{: number}, ${rest})@{: Promise<string>} { await later(turn); await null; ${body} }`,
        `await scene${n}(turn, 1)`,
      ],
      () => [
        `function* scene${n}(turn@{: number}, ${rest})@{: Generator<number, string>} { yield turn; ${body} }`,
        `[...(function* () { return yield* scene${n}(turn); })()].length + " " + (g => (g.next(), g.next().value))(scene${n}(turn, 3))`,
      ],
    ])();
    scenes.push(
      `${declared}\nfor (let turn = 0; turn < ${random.between(2, 5)}; turn++) {\n  try {\n    console.log("scene ${n}", turn, ${call});\n  } catch (error) {\n    console.log("scene ${n}", turn, "THROWS", (error@{ as Error}).name);\n  }\n}`,
    );
  }
  return typed(
    `const launder = new Function("value", process.argv[9] ?? "return value")@{ as <V>(value: V) => V};
@{type Loose = Record<string, any>;
}const isEven = launder((n@{: number}) => n % 2 === 0);
const isThird = launder((n@{: number}) => n % 3 === 0);
const never = launder(() => false);
const always = launder(() => true);
const same = @{<V,>}(value@{: V}) => value;
const later = (n@{: number}) => new Promise@{<number>}(resolve => setTimeout(resolve, 0, n));
const list = launder([1, 2, 3]);
const text = launder("text");
const options@{: Loose} = launder({ verbose: true, level: 2, inner: { on: 1 } });
const base@{: Loose} = ${random.pick(["{ first: 1 }", "launder({ first: 1, flag: 0 })", "{}", "{ a: 1, b: 2, key: 3 }"])};
${scenes.join("\n")}
export {};
`,
    isTyped,
  );
}
