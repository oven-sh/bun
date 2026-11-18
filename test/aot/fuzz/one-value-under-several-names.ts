// One value stands under two or three names: a parameter and copies of it. A test narrows one name, the names are
// compared with each other, and each is updated behind the test. The function is called with values inside and outside
// every narrowed set, of a few kinds only: with every kind among the arguments nothing is narrowed at all. What it
// pushes is printed with String, which asks for no type.
import type { Random } from "./random";

const wholes = ["0", "-2", "1", "-1", "7"];
const otherKinds: [number, string[]][] = [
  [5, ['""', '"0"', '"7"']],
  [5, ["undefined"]],
  [3, ["null"]],
  [2, ["2.5", "-0", "NaN", "4294967296", "1e21"]],
  [2, ["false", "true"]],
  [2, ["O1", "K1"]],
  [1, ["A0", "A1"]],
  [1, ["1n"]],
  [1, ["V1"]],
];

const prelude = `export {};
let asks = 0;
const V1 = { valueOf() { asks++; return 1; } };
class K { constructor() { this.id = 1; } }
const O1 = { id: 1 }, K1 = new K(), A0 = [], A1 = [1];
let T = [];
const lines = [];`;

type Name = { read: string; write?: string };

export function generate(random: Random): string {
  const mode = random.weighted([
    [4, "near"],
    [4, "dense"],
    [2, "wide"],
  ] as const);
  /** The mode "near" stays near to one of two shapes that were miscompiled. */
  const shape = mode === "near" ? random.between(1, 2) : 0;
  /** In the mode "near" a place keeps its usual text three times in four. */
  const usually = (text: string, other: () => string) => (mode === "near" && random.chance(0.75) ? text : other());

  const parameters = ["a", "b"];
  const head: string[] = [];
  const names: Name[] = [{ read: "b", write: "b" }];
  const copy = (name: string, of: string, plain: boolean) => {
    switch (plain ? 7 : random.below(9)) {
      case 0:
        head.push(`const ${name} = ${of};`);
        return names.push({ read: name });
      case 1:
      case 2:
        if (head.length) break;
        parameters.push(`${name} = ${of}`);
        return names.push({ read: name, write: name });
      case 3:
        head.push(`let [${name}] = [${of}];`);
        return names.push({ read: name, write: name });
      case 4:
        head.push(`let { ${name} } = { ${name}: ${of} };`);
        return names.push({ read: name, write: name });
      case 5:
        head.push(`let ${name} = ${of};`, `const read_${name} = () => ${name};`);
        return names.push({ read: random.chance(0.5) ? `read_${name}()` : name, write: name });
      case 6:
        head.push(`const box_${name} = { v: ${of} };`);
        return names.push({ read: `box_${name}.v`, write: `box_${name}.v` });
    }
    head.push(`let ${name} = ${of};`);
    return names.push({ read: name, write: name });
  };
  const byDefault = (name: string, of: string) => {
    parameters.push(`${name} = ${of}`);
    names.push({ read: name, write: name });
  };
  if (shape === 2) {
    if (random.chance(0.75)) byDefault("c", "b");
    else copy("c", "b", false);
    if (random.chance(0.75)) byDefault("d", "a");
    else copy("d", "a", false);
  } else {
    copy("c", "b", mode === "near" && random.chance(0.75));
    if (random.chance(mode === "near" ? 0.15 : 0.6)) copy("d", random.pick(["b", "c", "a", "a"]), false);
  }
  if (mode !== "near") names.push({ read: "a", write: "a" });

  const one = () => random.pick(names);
  const two = () => random.sample(names, 2);
  const equality = () => random.pick(["==", "!=", "===", "!==", "==", "!=="]);
  const kind = () => random.pick(["number", "string", "object", "undefined", "boolean", "bigint"]);
  const hasId = (x: string) => `typeof ${x} === "object" && ${x} !== null && "id" in ${x}`;

  // Few conditions, each in many places: a proof made for a test in one place must not be taken for the same test in
  // another.
  const again = (pool: string[], size: number, make: () => string) => {
    if (mode !== "near" && pool.length >= size && random.chance(0.85)) return random.pick(pool);
    const made = make();
    pool.push(made);
    return made;
  };
  const tests: string[] = [];
  const comparisons: string[] = [];
  const poolOfTests = random.between(2, 4);
  const poolOfComparisons = random.between(1, 3);
  const narrows = (x: string) => again(tests, poolOfTests, () => narrowsAnew(x));
  const compared = () => again(comparisons, poolOfComparisons, comparedAnew);
  const narrowsAnew = (x: string) =>
    random.pick([
      `!${x}`,
      `!${x}`,
      `!${x}`,
      `${x}`,
      `${x} == null`,
      `${x} != null`,
      `${x} === undefined`,
      `${x} === null`,
      `typeof ${x} === "${kind()}"`,
      `typeof ${x} !== "${kind()}"`,
      `${x} === 0`,
      `${x} == 0`,
      `${x} === ""`,
      `${x} == ""`,
      `${x} == false`,
      `${x}?.[0]`,
      `${x}?.length`,
      `(${x} ?? 1) === 1`,
      `${x} instanceof K`,
      `${x} instanceof Object`,
      `Array.isArray(${x})`,
      `Number.isInteger(${x})`,
      `(${x} | 0) === ${x}`,
      `Object.is(${x}, -0)`,
      `${x} !== ${x}`,
      hasId(x),
      hasId(x),
    ]);
  const comparedAnew = () => {
    const [x, y] = two();
    return random.weighted([
      [7, `${x.read} ${equality()} ${y.read}`],
      [1, `${x.read} ${random.pick(["<", "<=", ">", ">="])} ${y.read}`],
      [1, `Object.is(${x.read}, ${y.read})`],
      [1, `a ${equality()} ${x.read}`],
    ]);
  };
  const writable = () => random.pick(names.filter(name => name.write)).write!;
  const condition = (depth: number): string => {
    const x = one().read;
    switch (depth > 1 ? random.below(4) : random.below(12)) {
      case 0:
      case 1:
        return narrows(x);
      case 2:
      case 3:
        return compared();
      case 4:
      case 5:
        return `(${condition(depth + 1)} && ${condition(depth + 1)})`;
      case 6:
        return `(${condition(depth + 1)} || ${condition(depth + 1)})`;
      case 7:
        return `!(${condition(depth + 1)})`;
      case 8:
        return `${random.pick(["-1", "0", "-3"])} < ${x} && ${x} < ${random.pick(["2", "1", "8"])}`;
      case 9: {
        const [p, q] = two();
        return `${p.read} === ${q.read} && ${q.read} === ${one().read}`;
      }
      case 10:
        return `${writable()}${random.pick(["++", "--"])} ${random.pick([">=", "<=", "==", "==="])} ${x}`;
      default: {
        const [p, q] = two();
        return `${p.read} <= ${q.read} && ${q.read} <= ${p.read}`;
      }
    }
  };
  let loops = 0;
  const updateOf = (x: Name): string => {
    if (!x.write) return `T.push(${x.read});`;
    const w = x.write;
    return random.pick([
      `${w} -= 1;`,
      `${w} -= 1;`,
      `${w}--;`,
      `${w}--;`,
      `${w}++;`,
      `--${w};`,
      `${w} += 1;`,
      `${w} = -${w};`,
      `${w} = +${w};`,
      `${w} |= 0;`,
      `${w} = ~${w};`,
      `${w} -= ${one().read};`,
      `${w} = ${one().read};`,
    ]);
  };
  const update = () => updateOf(one());
  const optional = (x: string) =>
    random.pick([`${x}?.[0];`, `${x}?.[0];`, `${x}?.id;`, `${x}?.length;`, `void (${x} ?? 0);`]);
  const pushed = () =>
    random.pick([
      () => `T.push(${compared()});`,
      () => `T.push(${names.map(name => name.read).join(", ")});`,
      () => `T.push(${one().read});`,
      () => `T.push(typeof ${one().read});`,
      () => `T.push(${one().read}?.[0] === undefined);`,
      () => `T.push(${one().read} ?? "d");`,
    ])();
  const narrowed = (test: string, inside: string) =>
    random.weighted([
      [5, `if (${test}) { ${inside} }`],
      [3, `while (${test}) { ${inside} break; }`],
      [1, `if (${test}) { ${inside} } else { ${pushed()} }`],
    ]);
  const block = (depth: number, least: number): string =>
    Array.from({ length: random.between(least, 3) }, () => statement(depth + 1)).join(" ");
  const statement = (depth: number): string => {
    const x = one().read;
    switch (depth > 2 ? random.below(6) : random.below(mode === "near" ? 20 : 26)) {
      case 0:
        return pushed();
      case 1:
      case 2:
        return update();
      case 3:
      case 4:
        return random.pick([
          `${compared()};`,
          `T.x = ${compared()};`,
          `if (${compared()}) T.push(${random.below(9)});`,
        ]);
      case 5:
        return optional(x);
      case 6:
      case 7:
      case 8:
      case 9:
        return narrowed(narrows(x), `if (${compared()}) T.push(${random.below(9)}); ${block(depth, 0)}`);
      case 10:
      case 11:
        return narrowed(narrows(x), block(depth, 1));
      case 12:
        return `${narrows(x)} && T.push(${compared()});`;
      case 13:
        return `T.push(${narrows(x)} ? ${compared()} : ${one().read});`;
      case 14:
        return `switch (typeof ${x}) { case "number": T.push("n"); break; case "string": T.push("s"); break; case "object": ${update()} break; case "undefined": T.push("u"); break; default: T.push("?"); }`;
      case 15:
      case 16:
      case 17: {
        const [p, q] = two();
        const guard = random.pick([`a == ${x}`, `a == ${x}`, `a === ${x}`, compared()]);
        return `if (${guard}) { ${updateOf(p)} ${updateOf(q)} if (${narrows(one().read)}) T.push(${random.below(9)}); ${block(depth, 0)} }`;
      }
      case 18:
        return `if (${hasId(x)}) T.push(${random.below(9)});`;
      case 20:
      case 21:
        return `if (${condition(0)}) { ${block(depth, 1)} } else if (${condition(0)}) { ${block(depth, 1)} } else { ${block(depth, 0)} ${pushed()} }`;
      case 22:
        return `let n${++loops} = ${random.between(1, 3)}; while (n${loops}-- > 0 && ${condition(0)}) { ${block(depth, 1)} ${update()} }`;
      case 23:
        return `if (${condition(0)}) { T.push("@${random.below(20)}", ${names.map(name => name.read).join(", ")}); return; }`;
      case 24:
        return `if (${condition(0)}) { ${update()} ${pushed()} }`;
      case 25: {
        const [p, q] = two();
        return p.write && q.write ? `[${p.write}, ${q.write}] = [${q.read}, ${p.read}];` : `T.x = ${condition(0)};`;
      }
      default:
        return `if (${compared()}) { ${block(depth, 1)} }`;
    }
  };

  const c = names[1];
  const some = (least: number, most: number) => Array.from({ length: random.between(least, most) }, () => statement(0));
  const secondShape = () => {
    const [C, D] = [c.read, names[2].read];
    const inTheLoop = usually(`b -= ${D};`, update);
    // Only the usual text is known to leave the counter alone.
    const leaves = inTheLoop === `b -= ${D};` && names[2].write ? `${names[2].write} -= 1;` : "break;";
    return [
      ...some(0, 1),
      usually(`while (!b) {\n    if (${C} != b) T.push(b == null);\n    break;\n  }`, () =>
        narrowed(narrows(one().read), `if (${compared()}) T.push(b == null);`),
      ),
      usually(`T.x = b == ${C};`, () => random.pick([`${compared()};`, `T.x = ${compared()};`])),
      ...some(0, 1),
      `if (${usually(`!${D}`, () => narrows(one().read))}) {`,
      `  if (${usually(`(${D} | 0) === ${D}`, () => narrows(one().read))}) {\n    }`,
      `  T.push("@", a, ${usually("b?.[0] === undefined", () => `${one().read}?.${random.pick(["[0]", "id", "length"])}`)}, ${usually(`${C} ?? "d"`, () => `${one().read} ?? "d"`)}, ${D});`,
      `} else if (${usually(`!(typeof ${D} === "undefined")`, () => condition(1))}) {`,
      `  if (${usually(`${D} == b && Number.isInteger(${D}) && ${C} === ${D}`, () => condition(1))}) {`,
      `    if (${usually(`Number.isInteger(a) || Object.is(a, ${D})`, () => condition(1))}) {`,
      `      ${usually(c.write ? `${c.write} |= 0;` : "b |= 0;", update)} T.push(${usually(`Number.isInteger(${C}) || null < b`, () => condition(1))});`,
      `    }`,
      `    while (-1 < ${D} && ${D} < 2 && ${usually(hasId(C), () => narrows(one().read))}) {`,
      `      ${inTheLoop} T.push(typeof b);`,
      `      ${leaves}`,
      `    }`,
      `  }`,
      `}`,
      ...some(0, 1),
    ];
  };
  const body =
    shape === 2
      ? secondShape()
      : mode === "near"
        ? [
            ...some(0, 1),
            narrowed(
              usually("!b", () => narrows(one().read)),
              `if (${usually(`${c.read} !== b`, compared)}) T.push(1);`,
            ),
            ...some(0, 1),
            usually(`b == ${c.read};`, () => random.pick([`${compared()};`, `T.x = ${compared()};`])),
            usually("b?.[0];", () => optional(one().read)),
            ...some(0, 1),
            `if (${usually("a == b", () => random.pick([`a == ${one().read}`, `a === ${one().read}`, compared()]))}) { ${usually("b -= 1;", update)} ${usually(c.write ? `${c.write}--;` : "b--;", update)} if (${usually(hasId(c.read), () => narrows(one().read))}) T.push(2); }`,
            ...some(0, 1),
          ]
        : some(mode === "dense" ? 12 : 2, mode === "dense" ? 30 : 8);
  const text = [...head, ...body, `T.push("end", ${[...new Set(["a", ...names.map(name => name.read)])].join(", ")});`]
    .map(line => "  " + line)
    .join("\n");
  const [made, callee] = random.pick([
    [`function f(${parameters.join(", ")}) {\n${text}\n}`, "f"],
    [`function f(${parameters.join(", ")}) {\n${text}\n}`, "f"],
    [`const f = (${parameters.join(", ")}) => {\n${text}\n};`, "f"],
    [`class C {\n  f(${parameters.join(", ")}) {\n${text}\n  }\n}\nconst H = new C();`, "H.f"],
    [`const H = {\n  f(${parameters.join(", ")}) {\n${text}\n  },\n};`, "H.f"],
  ]);

  const usual = mode === "near" && random.chance(0.6);
  const palette = usual
    ? [...wholes, '""', "undefined"]
    : [
        ...(random.chance(0.9) ? wholes : []),
        ...Array.from({ length: mode === "wide" ? random.between(2, 6) : random.between(1, 3) }, () =>
          random.weighted(otherKinds),
        ).flat(),
      ];
  const pairs = usual
    ? random.shuffled(
        shape === 2
          ? [
              ["-2", "-2"],
              ["4294967296", "4294967296"],
              ['""', '""'],
              ["null", "null"],
              ...random.sample(
                [
                  ["0", "0"],
                  ['"7"', '"7"'],
                ],
                random.below(3),
              ),
            ]
          : [
              ["1", "0"],
              ["-2", "-2"],
              ["1", '""'],
              ["null", "undefined"],
            ],
      )
    : Array.from({ length: random.between(4, 10) }, () => {
        const b = random.pick(palette);
        return [random.chance(0.5) ? b : random.pick([...palette, "1", "null"]), b];
      });
  if (!usual && random.chance(0.6)) {
    const whole = random.pick(["-2", "-2", "7", "-1", "1"]);
    pairs.splice(random.below(pairs.length + 1), 0, [whole, whole]);
  }
  const said = `lines.push(T.map(String).join(" ") + " asks " + asks);`;
  const calls = random.chance(0.5)
    ? [
        `function go(a, b) {\n  T = [];\n  try {\n    ${callee}(a, b);\n  } catch (e) {\n    T.push("threw " + e.name);\n  }\n  ${said}\n}`,
        ...pairs.map(([a, b]) => `go(${a}, ${b});`),
      ]
    : pairs.map(
        ([a, b]) => `T = [];\ntry {\n  ${callee}(${a}, ${b});\n} catch (e) {\n  T.push("threw " + e.name);\n}\n${said}`,
      );
  return (
    [`// ${mode}${shape ? " " + shape : ""}`, prelude, made, ...calls, `console.log(lines.join("\\n"));`].join("\n") +
    "\n"
  );
}
