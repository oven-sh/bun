// Enums and namespaces, the two declarations of TypeScript that make objects when the program runs, and what the program sees of those objects.
//
//   enums       members without a value, with a number, a text, an expression over earlier members, a call; names in quotes and names that every object has; several members with one value;
//               `const enum`; an enum in two declarations, of which the later reads members of the earlier
//   namespaces  constants, variables that change, functions, classes, enums and namespaces inside; what is exported and what is not; patterns; two declarations of one name;
//               a namespace beside a function, a class or an enum of its name; names with dots; `import Name = Space.Member`
//   placed      at the top of the file, in a function, in a block; read ahead of the declaration and behind it
//   read        a member by name and under a key, the name under the value, the keys in their order, the attributes, as JSON; in a switch, as a key, in arithmetic; after the object was changed
import type { Random } from "./random";

const head = `const lines: string[] = [];
function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function step<T>(value: T): T {
  note("step", value);
  return value;
}
function attributes(holder: unknown): string {
  if ((typeof holder !== "object" && typeof holder !== "function") || holder === null) return "no object: " + show(holder);
  return (
    Reflect.ownKeys(holder)
      .map(name => {
        const found = Reflect.getOwnPropertyDescriptor(holder, name)!;
        return String(name) + ":" + ("value" in found ? "v" : (found.get ? "g" : "") + (found.set ? "s" : "")) + (found.writable ? "w" : "") + (found.enumerable ? "e" : "") + (found.configurable ? "c" : "");
      })
      .join(" ") +
    " | " +
    (Object.getPrototypeOf(holder) === Object.prototype ? "plain" : Object.getPrototypeOf(holder) === Function.prototype ? "function" : Object.getPrototypeOf(holder) === null ? "bare" : "other") +
    (Object.isExtensible(holder) ? "" : " closed")
  );
}
function attempt(label: string, run: () => unknown): void {
  try {
    note(label, run());
  } catch (error) {
    note(label, "THROWS", (error as Error).constructor.name);
  }
}
const seven = 7;
`;

const memberNames = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "lower",
  "$",
  "_",
  "toString",
  "constructor",
  "valueOf",
  "hasOwnProperty",
  "name",
  "length",
  "prototype",
  "default",
  "class",
  "function",
  "await",
  "of",
] as const;
const quotedNames = ['"a-b"', '"with space"', '""', '"A.B"', '"0x"', '"é"'] as const;

type Enum = { name: string; text: string; members: string[]; isConst: boolean; isNumeric: boolean[] };

function writeEnum(random: Random, name: string, isConst: boolean, earlier: Enum | undefined, prefix: string): Enum {
  const count = random.between(1, 6);
  const taken = new Set(earlier?.members);
  const members: string[] = [];
  const isNumeric: boolean[] = [];
  const rows: string[] = [];
  let mayGoOn = !earlier;
  for (let index = 0; index < count; index++) {
    const drawn = random.chance(0.12) ? random.pick(quotedNames) : random.pick(memberNames);
    if (taken.has(drawn)) continue;
    taken.add(drawn);
    const numbers = [
      ...(earlier ? earlier.members.filter((_, at) => earlier.isNumeric[at]) : []),
      ...members.filter((_, at) => isNumeric[at]),
    ].filter(each => /^[A-F]$/.test(each));
    const other = numbers.length ? random.pick(numbers) : undefined;
    const value = random.weighted<[string, boolean] | undefined>([
      [mayGoOn ? 6 : 0, undefined],
      [3, [String(random.pick([0, 1, 2, 5, 10, -1, -7, 100, 2147483647, 2147483648, 4294967296, 0.5, 1e21])), true]],
      [2, [JSON.stringify(random.pick(["a", "b", "text", "", "A", "0", "1"])), false]],
      [
        other ? 3 : 0,
        [
          random.pick([
            `${other} + 1`,
            `${other} * 2`,
            `${other} | 4`,
            `${other} << 2`,
            `-${other}`,
            `~${other}`,
            `${other} % 3`,
            `${other} ** 2`,
            `${name}.${other}`,
            `(${other})`,
            `${other} / 2`,
            `${other} >>> 1`,
          ]),
          true,
        ],
      ],
      [
        1,
        [
          random.pick([
            "1 << 3",
            "1 + 2 * 3",
            "0x10",
            "0b11",
            "1_000",
            ...(isConst ? [] : ["1 / 0", "-1 / 0", "0 / 0"]),
            "-0",
            "5 % 3",
            "2 ** 10",
            "~0",
            "+1",
          ]),
          true,
        ],
      ],
      [1, [random.pick(["`a`", '"a" + "b"', "`a${1}`"]), false]],
      [
        isConst ? 0 : 2,
        [
          random.pick([
            "step(3)",
            "seven",
            "seven + 1",
            "Math.floor(2.5)",
            "step(1) + step(2)",
            "[1, 2].length",
            "Number.MAX_SAFE_INTEGER",
          ]),
          true,
        ],
      ],
    ]);
    rows.push(value ? `${drawn} = ${value[0]},` : `${drawn},`);
    members.push(drawn);
    isNumeric.push(value ? value[1] : true);
    // A member without a value follows one whose number the compiler knows.
    mayGoOn = !value || /^-?[\d.e+]+$/.test(value[0]);
  }
  if (!members.length) {
    rows.push("Z = 1,");
    members.push("Z");
    isNumeric.push(true);
  }
  return {
    name,
    text: `${prefix}${isConst ? "const " : ""}enum ${name} {\n${rows.join("\n")}\n}`,
    members,
    isConst,
    isNumeric,
  };
}

const read = (holder: string, member: string) =>
  member.startsWith('"') ? `${holder}[${member}]` : `${holder}.${member}`;

function usesOfEnum(random: Random, made: Enum, path: string): string[] {
  const uses: string[] = [];
  for (const member of made.members) {
    uses.push(read(path, member));
    if (random.chance(0.3)) uses.push(`${path}[${member.startsWith('"') ? member : JSON.stringify(member)}]`);
    if (random.chance(0.3)) uses.push(`typeof ${read(path, member)}`);
  }
  const first = read(path, made.members[0]);
  const last = read(path, made.members[made.members.length - 1]);
  uses.push(
    `[${first}, ${last}].join()`,
    `\`\${${first}}|\${${last}}\``,
    `({ [${first}]: 1 })`,
    `(${first} as any) + (${last} as any)`,
    `(${first} as any) === (${last} as any)`,
  );
  uses.push(
    `(() => {\nswitch (${last} as any) {\ncase ${first}:\nreturn "first";\ncase ${last}:\nreturn "last";\n}\nreturn "none";\n})()`,
  );
  if (!made.isConst) {
    uses.push(
      `attributes(${path})`,
      `Object.keys(${path})`,
      `JSON.stringify(${path})`,
      `Object.entries(${path}).length`,
      `(${path} as any)[${first} as any]`,
      `(${path} as any)[0]`,
      `(${path} as any)[1]`,
      `(${path} as any)["NaN"]`,
    );
    uses.push(`(${path} as any)[step(${JSON.stringify(made.members[0].replaceAll('"', ""))})]`);
    uses.push(
      `(() => {\nconst names: string[] = [];\nfor (const name in ${path}) names.push(name);\nreturn names;\n})()`,
    );
    if (random.chance(0.4))
      uses.push(
        `(((${path} as any)${made.members[0].startsWith('"') ? `[${made.members[0]}]` : `.${made.members[0]}`} = "changed"), ${first})`,
        `(${path} as any)[step(${JSON.stringify(made.members[0].replaceAll('"', ""))})]`,
      );
    if (random.chance(0.2))
      uses.push(
        `(delete (${path} as any)${made.members[0].startsWith('"') ? `[${made.members[0]}]` : `.${made.members[0]}`}, ${first})`,
      );
  }
  return uses;
}

export function generate(random: Random): string {
  const parts: string[] = [head];
  let names = 0;
  const attempts = (uses: string[]) =>
    uses.map(use => `attempt(${JSON.stringify(use.replaceAll("\n", " "))}, () => ${use});`).join("\n");

  const enumScene = (): string => {
    const name = `Kind${++names}`;
    const isConst = random.chance(0.25);
    const first = writeEnum(random, name, isConst, undefined, "");
    const second = random.chance(0.3) ? writeEnum(random, name, isConst, first, "") : undefined;
    const all: Enum = second
      ? {
          ...first,
          members: [...first.members, ...second.members],
          isNumeric: [...first.isNumeric, ...second.isNumeric],
        }
      : first;
    const between = second && random.chance(0.5) ? attempts(usesOfEnum(random, first, name).slice(0, 4)) : "";
    const ahead = random.chance(0.3)
      ? attempts([read(name, first.members[0]), ...(isConst ? [] : [`typeof ${name}`])])
      : "";
    const body = [ahead, first.text, between, second?.text ?? "", attempts(usesOfEnum(random, all, name))]
      .filter(Boolean)
      .join("\n");
    return random.weighted([
      [5, body],
      [2, `function scene${names}() {\n${body}\n}\nscene${names}();${random.chance(0.4) ? `\nscene${names}();` : ""}`],
      [1, `{\n${body}\n}`],
      [1, `for (let turn = 0; turn < 2; turn++) {\n${body}\n}`],
    ]);
  };

  const namespaceBody = (
    name: string,
    depth: number,
    earlier: string[],
  ): { text: string; exported: string[]; uses: string[] } => {
    const rows: string[] = [];
    const exported: string[] = [];
    const uses: string[] = [];
    const id = ++names;
    const numbers: string[] = [...earlier];
    const pieces = random.between(1, 6);
    for (let index = 0; index < pieces; index++) {
      const n = `m${id}x${index}`;
      const other = numbers.length ? random.pick(numbers) : "seven";
      const isExported = random.chance(0.75);
      const word = isExported ? "export " : "";
      const kind = random.weighted([
        [4, "const"],
        [3, "let"],
        [1, "var"],
        [3, "function"],
        [2, "class"],
        [2, "enum"],
        [depth < 2 ? 2 : 0, "namespace"],
        [2, "pattern"],
        [2, "statement"],
        [1, "reads"],
      ] as const);
      switch (kind) {
        case "const":
          rows.push(
            `${word}const ${n} = ${random.pick([`step(${index})`, `${other} + 1`, `${index}`, `"t${index}"`, `{ a: ${other} }`, `() => ${other}`])};`,
          );
          if (/\+ 1;$|step\(|= \d+;$/.test(rows[rows.length - 1])) numbers.push(n);
          break;
        case "let":
        case "var":
          rows.push(`${word}${kind} ${n} = ${index};`, `${word}function bump${n}() {\nreturn ++${n};\n}`);
          numbers.push(n);
          if (isExported) {
            exported.push(`bump${n}`);
            uses.push(
              `[${name}.${n}, ${name}.bump${n}(), ${name}.${n}]`,
              `[(${name}.${n} = 50), ${name}.bump${n}(), ${name}.${n}]`,
            );
          }
          if (random.chance(0.4))
            rows.push(
              random.pick([
                `${n}++;`,
                `${n} += 2;`,
                `[${n}] = [9];`,
                `({ a: ${n} } = { a: 8 });`,
                `for (${n} = 0; ${n} < 3; ${n}++);`,
              ]),
            );
          break;
        case "function":
          if (random.chance(0.4)) rows.push(`note("ahead", ${n}());`);
          rows.push(`${word}function ${n}() {\nreturn ${other};\n}`);
          if (isExported) uses.push(`${name}.${n}()`, `${name}.${n}.name`);
          break;
        case "class":
          rows.push(`${word}class ${n} {\nstatic made = ${other};\nvalue = ${other};\n}`);
          if (isExported) uses.push(`${name}.${n}.made`, `new ${name}.${n}().value`, `${name}.${n}.name`);
          break;
        case "enum": {
          const made = writeEnum(random, n, random.chance(0.2), undefined, word);
          rows.push(made.text, `note("inside", ${read(n, made.members[0])});`);
          if (isExported) uses.push(...usesOfEnum(random, made, `${name}.${n}`).slice(0, 8));
          if (made.isConst) continue;
          break;
        }
        case "namespace": {
          const inner = namespaceBody(`${name}.${n}`, depth + 1, numbers);
          rows.push(`${word}namespace ${n} {\n${inner.text}\n}`);
          if (isExported) uses.push(...inner.uses, `attributes(${name}.${n})`);
          break;
        }
        case "pattern":
          rows.push(
            random.pick([
              `${word}const { a: ${n}, b: ${n}b = 2 } = step({ a: ${other} }) as { a: number; b?: number };`,
              `${word}const [${n}, ${n}b = 3] = step([${other}]) as number[];`,
              `${word}const { ...${n} } = { a: ${other} },\n${n}b = 4;`,
            ]),
          );
          if (isExported) {
            exported.push(`${n}b`);
            uses.push(`${name}.${n}b`);
          }
          break;
        case "statement":
          rows.push(
            random.pick([
              `note("statement ${n}", ${other});`,
              `if (${other}) note("taken ${n}");`,
              `note("self ${n}", Object.keys(${name.split(".")[0]}));`,
            ]),
          );
          continue;
        case "reads":
          rows.push(`note("reads ${n}", typeof ${name.split(".")[0]}, ${other});`);
          continue;
      }
      if (isExported) {
        exported.push(n);
        if (kind === "const" || kind === "pattern") uses.push(`${name}.${n}`);
      }
    }
    return { text: rows.join("\n"), exported, uses };
  };

  const namespaceScene = (): string => {
    const name = `Space${++names}`;
    const beside = random.weighted([
      [5, ""],
      [2, `function ${name}() {\nreturn "called";\n}`],
      [2, `class ${name} {\nstatic fixed = 1;\nvalue = 2;\n}`],
      [1, `enum ${name} {\nFirst,\nSecond = 5,\n}`],
    ]);
    const first = namespaceBody(name, 0, []);
    const numbers = first.exported.filter(each =>
      new RegExp(`export (const|let|var) ${each} = (\\d+|step\\(\\d+\\)|.* \\+ 1);`).test(first.text),
    );
    const second = random.chance(0.4) ? namespaceBody(name, 0, numbers) : undefined;
    const dotted = !beside && !second && random.chance(0.15);
    const uses = [
      ...first.uses,
      ...(second?.uses ?? []),
      `attributes(${name})`,
      `Object.keys(${name})`,
      `typeof ${name}`,
    ];
    if (beside.startsWith("function")) uses.push(`(${name} as any)()`);
    if (beside.startsWith("class")) uses.push(`${name}.fixed`, `new ${name}().value`);
    if (beside.startsWith("enum")) uses.push(`${name}.Second`, `(${name} as any)[5]`);
    if (dotted)
      return [
        `namespace ${name}.Middle.Last {\n${first.text.replaceAll(`${name}.`, `${name}.Middle.Last.`)}\n}`,
        attempts([`attributes(${name})`, `attributes(${name}.Middle)`, `attributes(${name}.Middle.Last)`]),
      ].join("\n");
    const alias =
      first.exported.length && random.chance(0.4)
        ? `import Alias${names} = ${name}.${first.exported[0]};\nattempt("alias", () => Alias${names});`
        : "";
    return [
      random.chance(0.3) ? attempts([`typeof ${name}`]) : "",
      beside,
      `namespace ${name} {\n${first.text}\n}`,
      second
        ? `${random.chance(0.5) ? attempts([`Object.keys(${name})`]) + "\n" : ""}namespace ${name} {\n${second.text}\n}`
        : "",
      alias,
      attempts(uses),
    ]
      .filter(Boolean)
      .join("\n");
  };

  const scenes = random.between(2, 5);
  for (let index = 0; index < scenes; index++) parts.push(random.chance(0.5) ? enumScene() : namespaceScene());
  parts.push(`console.log(lines.slice(0, 900).join("\\n"));\nconsole.log(lines.length);`);
  return parts.join("\n") + "\n";
}
