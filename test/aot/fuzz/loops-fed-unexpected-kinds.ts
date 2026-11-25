// Loops whose variables or elements arrive as kinds that the loop does not expect, so that the failing side of a type
// test runs. Most answers are joined with `+`, which asks for no type: a helper that asks `typeof` changes what the
// compiler believes of the variables. Each scene has functions of its own.
import type { Random } from "./random";

const kinds = [
  "3",
  "7",
  "0",
  "-1",
  "2.5",
  "-0.5",
  "2147483647",
  "-2147483648",
  "4294967296",
  "1e21",
  '"a"',
  '""',
  '"12"',
  '"x y"',
  "null",
  "true",
  "false",
  "[1,2]",
  "[]",
  '{"x":{"y":5},"p":1}',
  '{"p":"q"}',
  "{}",
];
const counts = ["2", "3", "4", "5", "3", "0", "1", "2.5", '"3"'];
const heads = [
  "while (--n >= 0) { BODY }",
  "while (n-- > 0) { BODY }",
  "while (0 <= --n) { BODY }",
  "while (!(--n < 0)) { BODY }",
  "for (;;) { if (--n < 0) break; BODY }",
  "do { BODY } while (--n > 0);",
  "for (; n > 0; n -= 1) { BODY }",
  "for (let i = 0; i < n; i++) { BODY }",
];

type Wrapped = { text: string; call: (given: string[]) => string };

/** The same body as a function, an arrow function, a method, a generator or an async function. */
function wrapped(random: Random, name: string, parameters: string[], body: string[], answer: string): Wrapped {
  const list = parameters.join(", ");
  const inside = (word: string) => [...body, `${word} ${answer};`].map(line => "  " + line).join("\n");
  const direct = (given: string[]) => `${name}(${given.join(", ")})`;
  switch (random.below(5)) {
    case 0:
      return { text: `const ${name} = (${list}) => {\n${inside("return")}\n};`, call: direct };
    case 1:
      return {
        text: `const holder_${name} = {\n${name}(${list}) {\n${inside("return")}\n},\n};`,
        call: given => `holder_${name}.${direct(given)}`,
      };
    case 2:
      return {
        text: `function* steps_${name}(${list}) {\n${inside("yield")}\n}\nfunction ${name}(${list}) {\n  return steps_${name}(${list}).next().value;\n}`,
        call: direct,
      };
    case 3:
      return {
        text: `async function ${name}(${list}) {\n${inside("return")}\n}`,
        call: given => `await ${direct(given)}`,
      };
    default:
      return { text: `function ${name}(${list}) {\n${inside("return")}\n}`, call: direct };
  }
}

/** Behind a loop these make a function too long to be compiled as hot code. */
const dull = (scene: number) => Array.from({ length: 64 }, (_, i) => `if (n === ${1000 + i}) seen${scene} += ${i};`);

const printed = (scene: number, rows: string[], call: string, guarded: boolean) =>
  [
    `const answers${scene} = [];`,
    `for (const q of JSON.parse('[${rows.join(",")}]')) {`,
    guarded
      ? `  try { answers${scene}.push(${call}); } catch (error) { answers${scene}.push("threw " + error.constructor.name); }`
      : `  answers${scene}.push(${call});`,
    `}`,
    `for (const answer of answers${scene}) console.log(${scene}, answer.length > 300 ? answer.length + " characters" : answer);`,
  ].join("\n");

/** Variables are handed on from one to the next while another one, which `+` may turn into a text, moves on. */
function handedOn(random: Random, scene: number): string {
  const names = Array.from({ length: random.between(2, 4) }, (_, i) => `h${i}`);
  const last = names.length - 1;
  const moves = random.pick([
    [
      ...names
        .slice(1)
        .map((name, i) => `${name} = ${names[i]};`)
        .reverse(),
      `${names[0]} = cur;`,
    ],
    [`t = ${names[0]};`, ...names.slice(0, last).map((name, i) => `${name} = ${names[i + 1]};`), `${names[last]} = t;`],
    [`[${names.join(", ")}] = [${[...names.slice(1), names[0]].join(", ")}];`],
  ]);
  const step = random.pick([
    "cur = cur + 3;",
    "cur = 3 + cur;",
    "cur += 3;",
    'cur = cur + "";',
    "cur++;",
    "cur = -cur;",
  ]);
  const start = random.below(3);
  const declared = names.map(name => `${name} = ${["cur", `"${name}"`, `{ v: "${name}" }`][start]}`);
  const body = random.chance(0.5) ? [...moves, step] : [step, ...moves];
  const show = `show${scene}`;
  const made = wrapped(
    random,
    `F${scene}`,
    ["cur", "n"],
    [
      `let ${(random.chance(0.5) ? declared : declared.reverse()).join(", ")}, t;`,
      random.pick(heads).replace("BODY", body.join(" ")),
      ...(random.chance(0.4) ? dull(scene) : []),
    ],
    [...names, "cur"].map(name => (start === 2 ? `${show}(${name})` : name)).join(' + "|" + '),
  );
  const texts = ['"a"', '"b"', '""', '"12"'];
  const rows = Array.from({ length: random.between(4, 8) }, () => {
    const value = random.weighted([
      [4, () => random.pick(["100", "7.5", "1", "0", "-1", "2147483647"])],
      [4, () => random.pick(texts)],
      [2, () => random.pick(kinds)],
    ])();
    return `[${value},${random.pick(counts)}]`;
  });
  return [
    `let seen${scene} = 0;`,
    `function ${show}(x) {\n  return typeof x === "object" && x !== null ? x.v : String(x);\n}`,
    made.text,
    printed(scene, rows, made.call(["q[0]", "q[1]"]), false),
  ].join("\n");
}

/** A loop over elements of two kinds reads a member of a member that every element, or all but one, lacks. */
function missingMember(random: Random, scene: number): string {
  const read = random.pick([
    "E.x.y;",
    'E.x["y"];',
    'E["x"].y;',
    `E.x[name${scene}];`,
    "if (E.x.y) kept = 1;",
    "if (!E.x.y) kept = 2;",
    `take${scene}(E.x.y);`,
    "kept = `${E.x.y}`;",
    "kept = typeof E.x.y;",
    "E.x.y += 1;",
    "E.x?.y.z; E.x.y;",
    "E?.x.y;",
    "kept = E.x.y === 1;",
    "kept = 1 === E.x.y;",
    "kept = E && E.x.y;",
    "kept = E.x.y || 3;",
    "kept = E.x.y ? 1 : 2;",
    "void E.x.y;",
    "(0, E.x.y);",
    "E.x.length;",
    "E.n.y;",
    "E.n.y; E.x.y;",
  ]);
  const tried = random
    .pick([
      "try { READ } catch {}",
      "try { READ } catch (error) { caught++; }",
      "try { caught++; READ caught--; } catch {}",
      "try { try { READ } finally { finals++; } } catch { caught++; }",
      "READ passed++;",
    ])
    .replace("READ", read);
  const loop = random
    .pick([
      "for (const E of list) { BODY }",
      "for (let i = 0; i < list.length; i++) { const E = list[i]; BODY }",
      "for (let i = list.length - 1; i >= 0; i--) { const E = list[i]; BODY }",
      "for (let i = 0; list.length > i; i++) { const E = list[i]; BODY }",
      "let i = 0; while (i < list.length) { const E = list[i++]; BODY }",
      "let i = 0; do { const E = list[i++]; BODY } while (i < list.length);",
      "for (const k in list) { const E = list[k]; BODY }",
    ])
    .replace("BODY", tried);
  const good = "{ x: { y: 1, length: 1 }, n: { y: 2 } }";
  const elements = random.pick([
    "[[], {}]",
    "[{}, []]",
    "[[], {}, [], {}]",
    "Object.values({ a: [], b: {} })",
    "[Object.assign([], { n: null }), { n: null }]",
    `[${good}, [], {}]`,
    `[[], {}, ${good}]`,
  ]);
  const made = wrapped(
    random,
    `run${scene}`,
    ["list"],
    ["let caught = 0, finals = 0, passed = 0, kept;", loop],
    'caught + "|" + finals + "|" + passed + "|" + String(kept)',
  );
  const asked = (given: string) =>
    `try {\n  result${scene} = ${made.call([given])};\n} catch (outer) {\n  result${scene} = said${scene}(outer);\n}\nconsole.log(${scene}, result${scene});`;
  return [
    `const name${scene} = "y";`,
    `function take${scene}(x) {\n  return x;\n}`,
    `function said${scene}(e) {\n  return e instanceof Error && e.message.startsWith("fail ") ? e.message : "threw " + typeof e;\n}`,
    made.text,
    `let result${scene};`,
    asked(elements),
    ...(random.chance(0.3) ? [asked(`JSON.parse('[[],{},{"x":{"y":4}}]')`)] : []),
    `console.log(${scene}, Array.from({ length: 3 }).length);`,
  ].join("\n");
}

/** Two to five variables are handed on, swapped, rotated, added to and read through. */
function mixed(random: Random, scene: number): string {
  const names = Array.from({ length: random.between(2, 5) }, (_, i) => `v${i}`);
  const two = () => random.sample(names, 2);
  const statement = (depth: number): string => {
    const [a, b] = two();
    const c = random.pick(names);
    switch (random.below(20)) {
      case 4:
        return `t = ${a}; ${a} = ${b}; ${b} = t;`;
      case 5: {
        if (names.length < 3) return `${a} = ${b};`;
        const [x, y, z] = random.sample(names, 3);
        return `[${x}, ${y}, ${z}] = [${y}, ${z}, ${x}];`;
      }
      case 6:
        return `${a} = ${a} + ${random.pick(["1", "3", "0.5", '"z"', b])};`;
      case 7:
        return `${c} = ${a} ${random.pick(["+", "-", "*", "|", "&", ">>", "%"])} ${random.pick([b, "2", "7"])};`;
      case 8:
        return `${a}${random.pick(["++", "--"])};`;
      case 9:
        return `${a} = ${random.pick(["-", "+", "~", "!", "typeof "])}${b};`;
      case 10:
        return `${a} = list${scene}[${random.pick(["n & 3", "turn & 3", "1"])}];`;
      case 11:
        return `box.p = ${a}; ${b} = box.p;`;
      case 12:
        return `try { ${a} = ${b}.x.y; } catch { ${c} = ${c} + 1; }`;
      case 13:
        return `${c} = ${a} ${random.pick(["===", "<", "==", ">="])} ${b};`;
      case 14:
        return `${a} = ${b}?.p ?? ${c};`;
      case 15:
        return `${a} = String(${b}).length;`;
      case 16: {
        if (depth >= 2) return `${a} = ${b};`;
        const kind = random.pick(["string", "number", "object"]);
        const test = random.pick([`${a} > ${b}`, `typeof ${a} === "${kind}"`, `${a} === ${b}`, "turn & 1", a]);
        return `if (${test}) { ${statement(depth + 1)} }${random.chance(0.4) ? ` else { ${statement(depth + 1)} }` : ""}`;
      }
      case 17:
        return `${a} = step${scene}(${b});`;
      case 18:
        return `${a} = ${b} + "";`;
      default:
        return `${a} = ${b};`;
    }
  };
  const body = Array.from({ length: random.between(2, 6) }, () => statement(0)).join(" ") + " turn++;";
  const head = random.pick([...heads, `while (${names[0]} !== ${names[names.length - 1]} && --n >= 0) { BODY }`]);
  const all = [...names, "t", "turn", "n"];
  const made = wrapped(
    random,
    `F${scene}`,
    ["a", "b", "c", "n"],
    [
      `let ${random
        .shuffled(names)
        .map(name => `${name} = ${random.pick(["a", "b", "c"])}`)
        .join(", ")}, t, turn = 0;`,
      "const box = { p: 0 };",
      head.replace("BODY", body),
      ...(random.chance(0.34) ? dull(scene) : []),
    ],
    random.pick([
      all.join(' + "|" + '),
      "`" + all.map(name => "${" + name + "}").join("|") + "`",
      `[${all.join(", ")}].join("|")`,
      `[${all.join(", ")}].map(show${scene}).join("|")`,
    ]),
  );
  const rows = Array.from(
    { length: 8 },
    () => `[${random.pick(kinds)},${random.pick(kinds)},${random.pick(kinds)},${random.pick(counts)}]`,
  );
  if (random.chance(0.7)) rows.unshift("[3,4,5,3]");
  return [
    `let seen${scene} = 0;`,
    `const list${scene} = [1, "two", 3.5, { p: 4 }];`,
    `function show${scene}(x) {\n  return x === null ? "null" : typeof x === "object" ? "o" + JSON.stringify(x) : Object.is(x, -0) ? "-0" : (typeof x)[0] + String(x);\n}`,
    `function step${scene}(x) {\n  return typeof x === "number" ? x + 1 : x;\n}`,
    made.text,
    printed(scene, rows, made.call(["q[0]", "q[1]", "q[2]", "q[3]"]), true),
  ].join("\n");
}

export function generate(random: Random): string {
  const scenes = Array.from({ length: random.chance(0.75) ? 1 : 2 }, (_, scene) =>
    random.weighted([
      [3, handedOn],
      [3, missingMember],
      [4, mixed],
    ])(random, scene + 1),
  );
  // Under --aot-allow-code-from-disk only a program that may load code the build never saw is compiled otherwise.
  const door = random.chance(0.25) ? ["if (process.argv.length > 20) import(process.argv[20]);"] : [];
  return ["export {};", ...scenes, ...door].join("\n") + "\n";
}
