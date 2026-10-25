// Draws TypeScript types, writes a program that parses texts under each of them (`JSON.parse(text) as T`, a variable of type T, the
// body of a request or a response), builds it and lets it run. The program makes its own texts, as many as the time allows: texts
// that are a T, nearly a T, JSON of another shape, nearly JSON. texts-for-generated-types-driver.ts says what it asks of each.
//
// The type is only what the compiler expects. Nothing is checked and nothing throws because of it: every call gives what `JSON.parse(text)` gives.
// For every type the program also holds a function that reads each member through the type, and a twin with the same body whose
// parameter is `any`. What was parsed under the type goes to the first, what `JSON.parse(text)` gives to the second: both print the same.
//
//   bun test/aot/fuzz/texts-for-generated-types.ts --seconds 600 --jobs 16 --out /tmp/texts [--bun <path>] [--seed <n>] [--types 40] [--run-seconds 20] [--flags "--aot-validate;--aot-heat=everything-is-hot"] [--stress 1,2,3,5,7,11] [--growth] [--full-heap] [--workers]
//   bun test/aot/fuzz/texts-for-generated-types.ts --print <seed> [--types 40]      the program of one seed
//
// --growth asks one thing only: texts that grow sixteenfold, of many kinds, may take sixteen times as long, not their square.
// --full-heap keeps what is parsed until no more fits into a small heap, again and again. --workers runs the program in Workers that are ended after a few milliseconds.
// <out>/findings/<seed>/ holds the program, what it printed and how it ended.
import { spawn } from "bun";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Random } from "./random";
import { revivers, type Description, type Member } from "./texts-for-generated-types-driver";

const plainNames = [
  "id",
  "name",
  "kind",
  "type",
  "items",
  "count",
  "flag",
  "note",
  "tags",
  "inner",
  "value",
  "left",
  "right",
  "size",
  "x",
  "y",
  "z",
  "a",
  "b",
  "c",
];
const alikeNames = [
  "key_0001",
  "key_0002",
  "key_0011",
  "key_1001",
  "kez_0001",
  "aaaaaaaa",
  "aaaaaaab",
  "baaaaaaa",
  "aaaabaaa",
  "aaaaaaa",
  "aaaaaaaaa",
  "valueOne",
  "valueTwo",
  "valuesOne",
  "Value",
  "VALUE",
  "value_",
  "_value",
  "ab",
  "ba",
  "abc",
  "acb",
  "cab",
];
const oddNames = [
  "__proto__",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "length",
  "prototype",
  "then",
  "toJSON",
  "",
  " ",
  "0",
  "1",
  "2",
  "42",
  "-0",
  "-1",
  "01",
  "1e3",
  "1.5",
  "4294967294",
  "4294967295",
  "4294967296",
  "with-dash",
  "a b",
  "a.b",
  "é",
  "ÿ",
  "Ā",
  "日本",
  "😀",
  "a\nb",
  "\0",
  '"',
  "\\",
  "/",
  " ",
  "null",
  "true",
  "undefined",
  "NaN",
];

export function program(seed: number, count: number): string {
  const random = new Random(seed);
  const descriptions: Description[] = [];
  const declarations: string[] = [];
  const cases: string[] = [];
  let self = 0;
  let usesSelf = false;
  let portion = 1;
  let unions = 0;
  const enums: string[] = [];
  const shareable: number[] = [];
  const mentionsNamed = (description: Description): boolean => JSON.stringify(description).includes('"named"');

  const nameOfMember = (taken: Set<string>, plain = false): string => {
    for (;;) {
      const draw = random.below(plain ? 75 : 100);
      let name =
        draw < 55
          ? random.pick(plainNames)
          : draw < 75
            ? random.pick(alikeNames)
            : draw < 92
              ? random.pick(oddNames)
              : draw < 97
                ? "m" + random.below(1000)
                : random.pick(["long_", "長い"]).repeat(random.pick([8, 40, 700]));
      if (taken.has(name)) name = "m" + taken.size + "_" + random.below(1000);
      if (taken.has(name)) continue;
      taken.add(name);
      return name;
    }
  };

  const number = (): Description => ({ kind: "number" });
  const string = (): Description => ({ kind: "string" });

  const literal = (): Description => ({
    kind: "literal",
    value: random.pick<string | number | boolean>([
      "a",
      "b",
      "ab",
      "ba",
      "circle",
      "square",
      "circles",
      "",
      " ",
      "0",
      "1",
      "null",
      "true",
      "é",
      "日",
      "😀",
      "a\nb",
      "A",
      0,
      1,
      2,
      -1,
      10,
      1.5,
      255,
      2147483647,
      2147483648,
      -2147483648,
      1e21,
      0.1,
      true,
      false,
    ]),
  });

  function object(depth: number, size?: number): Extract<Description, { kind: "object" }> {
    const taken = new Set<string>();
    const members: Member[] = [];
    size ??=
      depth === 0
        ? random.weighted([
            [30, random.between(1, 6)],
            [10, random.between(7, 16)],
            [2, 0],
            [4, random.pick([31, 32, 33])],
            [3, random.pick([63, 64, 65])],
            [2, random.pick([100, 127, 128, 129])],
            [1, random.pick([255, 256, 257, 300])],
          ])
        : random.between(0, 4);
    const simple = size > 20;
    const withRest = unions === 0 && random.chance(0.08);
    for (let at = 0; at < size; at++) {
      const type = random.chance(0.12)
        ? ({ kind: "int32" } as Description)
        : simple || withRest
          ? scalar()
          : typeAt(depth + 1);
      const optional = random.chance(0.25);
      members.push({ name: nameOfMember(taken, withRest), optional, type });
    }
    if (withRest)
      return {
        kind: "object",
        members,
        rest: random.chance(0.3)
          ? { kind: "anything" }
          : { kind: "union", of: [{ kind: "number" }, { kind: "string" }, { kind: "boolean" }, { kind: "null" }] },
      };
    return { kind: "object", members };
  }

  const scalar = (): Description =>
    random.weighted<() => Description>([
      [5, number],
      [5, string],
      [2, () => ({ kind: "boolean" })],
      [1, () => ({ kind: "null" })],
      [2, literal],
      [1, scalarUnion],
    ])();

  function scalarUnion(): Description {
    const arms: Description[] = [];
    for (const arm of [number, string, (): Description => ({ kind: "boolean" }), (): Description => ({ kind: "null" })])
      if (random.chance(0.5)) arms.push(arm());
    while (arms.length < 2) arms.push(literal());
    return { kind: "union", of: arms };
  }

  function union(depth: number): Description {
    unions++;
    const made = unionOf(depth);
    unions--;
    return made;
  }

  function unionOf(depth: number): Description {
    const draw = random.below(10);
    if (draw < 2) return scalarUnion();
    if (draw < 4 && random.chance(0.15)) {
      const size = random.pick([40, 300]);
      const make = random.pick<(at: number) => string | number>([
        at => "k" + at,
        at => at,
        at => String(at).padStart(4, "0"),
        at => "aaaaaaaa".slice(0, at % 8) + "b" + "aaaaaaaa".slice(at % 8) + (at >> 3),
        at => at * 1000003,
        at => at / 4,
      ]);
      return { kind: "union", of: Array.from({ length: size }, (_, at) => ({ kind: "literal", value: make(at) })) };
    }
    if (draw < 4) {
      const values = new Set<string | number | boolean>();
      for (let count = random.between(2, 6); count > 0; count--)
        values.add((literal() as Extract<Description, { kind: "literal" }>).value);
      return { kind: "union", of: [...values].map(value => ({ kind: "literal", value })) };
    }
    if (draw < 7) {
      // Objects that a member with a literal type tells apart.
      const tag = random.pick(["kind", "type", "t", "0", "__proto__", "with-dash"]);
      const tags = random.chance(0.7)
        ? ["a", "b", "ab", "circle", "circles", "square", ""]
        : random.chance(0.5)
          ? [0, 1, 2, -1, 1.5]
          : [true, false];
      const arms: Description[] = [];
      for (const value of tags.slice(0, random.between(2, tags.length))) {
        const arm = object(depth + 1, random.between(0, 3));
        arm.members = arm.members.filter(member => member.name !== tag);
        arm.members.splice(random.below(arm.members.length + 1), 0, {
          name: tag,
          optional: false,
          type: { kind: "literal", value },
        });
        arms.push(arm);
      }
      if (random.chance(0.2)) arms.push({ kind: "null" });
      return { kind: "union", of: arms };
    }
    const arms: Description[] = [];
    for (let count = random.between(2, 4); count > 0; count--)
      arms.push(random.chance(0.6) ? object(depth + 1, random.between(1, 3)) : typeAt(depth + 1, true));
    return { kind: "union", of: arms };
  }

  function typeAt(depth: number, inUnion = false): Description {
    if (depth > 3) return scalar();
    return random.weighted<() => Description>([
      [8, number],
      [8, string],
      [3, () => ({ kind: "boolean" })],
      [inUnion ? 2 : 1, () => ({ kind: "null" })],
      [3, literal],
      [inUnion ? 0 : 1, () => ({ kind: "anything" })],
      [inUnion ? 0 : 1, () => ({ kind: "object or array" })],
      [7, () => ({ kind: "array", of: typeAt(depth + 1) })],
      [3, () => ({ kind: "tuple", of: Array.from({ length: random.between(0, 4) }, () => typeAt(depth + 1)) })],
      [3, () => ({ kind: "record", of: typeAt(depth + 1) })],
      [9, () => object(depth)],
      [inUnion ? 0 : 6, () => union(depth)],
      [shareable.length ? 2 : 0, () => ({ kind: "named", index: random.pick(shareable) })],
    ])();
  }

  /** A type that holds itself. */
  function recursive(): Description {
    usesSelf = true;
    const me: Description = { kind: "named", index: self };
    const held = scalar();
    return random.pick<() => Description>([
      () => ({
        kind: "object",
        members: [
          { name: "value", optional: false, type: held },
          { name: "next", optional: true, type: me },
        ],
      }),
      () => ({
        kind: "object",
        members: [
          { name: "next", optional: false, type: { kind: "union", of: [me, { kind: "null" }] } },
          { name: "value", optional: false, type: held },
        ],
      }),
      () => ({
        kind: "object",
        members: [
          { name: "value", optional: false, type: held },
          { name: "kids", optional: false, type: { kind: "array", of: me } },
        ],
      }),
      () => ({
        kind: "object",
        members: [
          { name: "left", optional: true, type: me },
          { name: "n", optional: false, type: { kind: "int32" } },
          { name: "right", optional: true, type: me },
        ],
      }),
      () => ({ kind: "union", of: [held.kind === "union" ? { kind: "number" } : held, { kind: "array", of: me }] }),
      () => ({ kind: "union", of: [{ kind: "number" }, { kind: "record", of: me }] }),
      () => ({
        kind: "union",
        of: [
          { kind: "null" },
          { kind: "boolean" },
          { kind: "number" },
          { kind: "string" },
          { kind: "array", of: me },
          { kind: "record", of: me },
        ],
      }),
      () => ({
        kind: "union",
        of: [
          {
            kind: "object",
            members: [
              { name: "kind", optional: false, type: { kind: "literal", value: "leaf" } },
              { name: "value", optional: false, type: held },
            ],
          },
          {
            kind: "object",
            members: [
              { name: "kind", optional: false, type: { kind: "literal", value: "node" } },
              { name: "left", optional: false, type: me },
              { name: "right", optional: false, type: me },
            ],
          },
        ],
      }),
      () => ({ kind: "tuple", of: [held, { kind: "union", of: [me, { kind: "null" }] }] }),
      () => ({ kind: "array", of: me }),
      () => ({ kind: "record", of: me }),
    ])();
  }

  // ---- the type as TypeScript

  const key = (name: string): string =>
    /^[A-Za-z_$][\w$]*$/.test(name) && name !== "__proto__" ? name : JSON.stringify(name);

  function write(description: Description, inner: boolean): string {
    const grouped = (text: string): string => (inner ? "(" + text + ")" : text);
    switch (description.kind) {
      case "number":
      case "int32":
      case "string":
      case "boolean":
      case "null":
        return description.kind;
      case "literal":
        return JSON.stringify(description.value);
      case "anything":
        return random.chance(0.5) ? "any" : "unknown";
      case "object or array":
        return "object";
      case "array":
        return write(description.of, true) + "[]";
      case "tuple":
        return "[" + description.of.map(item => write(item, false)).join(", ") + "]";
      case "record":
        return "{ [key: string]: " + write(description.of, false) + " }";
      case "object": {
        const member = (one: Member): string =>
          key(one.name) + (one.optional ? "?" : "") + ": " + write(one.type, false);
        const members = description.members;
        if (description.rest)
          return (
            "{ " +
            [
              ...members.map(member),
              "[key: string]: " +
                write(description.rest, false) +
                (description.rest.kind !== "anything" && members.some(one => one.optional) ? " | undefined" : ""),
            ].join("; ") +
            " }"
          );
        if (members.length > 1 && random.chance(0.1)) {
          const at = random.between(1, members.length - 1);
          return grouped(
            "{ " +
              members.slice(0, at).map(member).join("; ") +
              " } & { " +
              members.slice(at).map(member).join("; ") +
              " }",
          );
        }
        return "{ " + members.map(member).join("; ") + " }";
      }
      case "union": {
        // Literals that are all texts or numbers can be the members of an enum.
        const values = description.of.map(arm =>
          arm.kind === "literal" && typeof arm.value !== "boolean" && !Object.is(arm.value, -0) ? arm.value : undefined,
        );
        if (values.every(value => value !== undefined) && random.chance(0.2)) {
          const name = "E" + enums.length;
          enums.push(
            `${random.chance(0.3) ? "const " : ""}enum ${name} { ${values.map((value, at) => "M" + at + " = " + JSON.stringify(value)).join(", ")} }`,
          );
          return name;
        }
        return grouped(description.of.map(arm => write(arm, true)).join(" | "));
      }
      case "named":
        return "T" + description.index;
    }
  }

  // ---- the function that reads every member

  const resolve = (description: Description): Description =>
    description.kind === "named" ? resolve(descriptions[description.index] ?? current!) : description;
  let current: Description | undefined;

  function arms(description: Description, into: Description[] = []): Description[] {
    const resolved = description.kind === "named" ? resolve(description) : description;
    if (resolved.kind === "union") for (const arm of resolved.of) arms(arm, into);
    else into.push(description);
    return into;
  }

  function read(description: Description, from: string, level: number, suffix: string): string {
    const x = "x" + level;
    switch (description.kind) {
      case "number":
        return `{ const ${x} = ${from}; out += (Object.is(${x}, -0) ? "-0" : "" + ${x}) + "," + ${x} * 2 + ";"; }`;
      case "int32":
        return `{ const ${x} = ${from}; out += ${x} + "," + ((${x} + 1) | 0) + "," + (${x} >> 1) + "," + 1 / ${x} + ";"; }`;
      case "string":
        return `{ const ${x} = ${from}; out += ${x}.length + ":" + ${x} + ";"; }`;
      case "boolean":
        return `out += ${from} ? "T" : "F";`;
      case "null":
        return `out += ${from} === null ? "N" : "?";`;
      case "literal":
        return typeof description.value === "number"
          ? `{ const ${x} = ${from}; out += ${x} + "," + 1 / ${x} + ";"; }`
          : `{ const ${x} = ${from}; out += typeof ${x} + ":" + ${x} + ";"; }`;
      case "anything":
      case "object or array":
        return `out += spellValue(${from});`;
      case "array":
        return `{ const ${x} = ${from}; out += "[" + ${x}.length + ":"; for (let k${level} = 0; k${level} < ${x}.length && k${level} < 300; k${level}++) ${read(description.of, `${x}[k${level}]`, level + 1, suffix)} out += "]"; }`;
      case "tuple":
        return `{ const ${x} = ${from}; out += "(" + ${x}.length + ":"; ${description.of.map((item, at) => read(item, `${x}[${at}]`, level + 1, suffix)).join(" ")} out += ")"; }`;
      case "record":
        return `{ const ${x} = ${from}; out += "{"; for (const k${level} in ${x}) { out += k${level} + "="; ${read(description.of, `${x}[k${level}]`, level + 1, suffix)} } out += "}"; }`;
      case "object": {
        let text = `{ const ${x} = ${from}; out += "<";`;
        for (const member of description.members) {
          if (portion < 1 && !random.chance(portion)) continue;
          const place = `${x}[${JSON.stringify(member.name)}]`;
          if (member.optional)
            text += ` { const o${level} = ${place}; if (o${level} === undefined) out += "-"; else ${read(member.type, "o" + level, level + 1, suffix)} }`;
          else text += " " + read(member.type, place, level + 1, suffix);
        }
        if (description.rest && portion === 1) text += ` out += spellValue(${x});`;
        return text + ` out += ">"; }`;
      }
      case "named":
        return `out += read${description.index}${suffix}(${from});`;
      case "union": {
        const all = arms(description);
        const kindOf = (arm: Description): string => {
          const resolved = resolve(arm);
          if (resolved.kind === "literal") return typeof resolved.value;
          if (resolved.kind === "tuple") return "array";
          if (resolved.kind === "record") return "object";
          return resolved.kind;
        };
        const ofKind = (kind: string): Description[] => all.filter(arm => kindOf(arm) === kind);
        const branches: [string, string][] = [];
        if (ofKind("null").length) branches.push([`${x} === null`, `out += "N";`]);
        if (ofKind("number").length)
          branches.push([`typeof ${x} === "number"`, read({ kind: "number" }, x, level + 1, suffix)]);
        if (ofKind("string").length)
          branches.push([`typeof ${x} === "string"`, read({ kind: "string" }, x, level + 1, suffix)]);
        if (ofKind("boolean").length)
          branches.push([`typeof ${x} === "boolean"`, read({ kind: "boolean" }, x, level + 1, suffix)]);
        const arrays = ofKind("array");
        if (arrays.length)
          branches.push([
            `Array.isArray(${x})`,
            arrays.length === 1 ? read(arrays[0], x, level + 1, suffix) : `out += spellValue(${x});`,
          ]);
        const objects = ofKind("object");
        if (objects.length === 1) branches.push(["", read(objects[0], x, level + 1, suffix)]);
        else if (objects.length) branches.push(["", readOneOf(objects, x, level, suffix)]);
        let text = `{ const ${x} = ${from}; `;
        branches.forEach(([test, body], at) => {
          text +=
            (at ? " else " : "") + (at === branches.length - 1 ? (at ? "" : "") : `if (${test}) `) + `{ ${body} }`;
        });
        return text + " }";
      }
    }
  }

  /** Several object types: told apart by a member with a literal type, or by a name that one of them alone declares. */
  function readOneOf(objects: Description[], x: string, level: number, suffix: string): string {
    const resolved = objects.map(resolve);
    // `{}` may be a primitive value as far as the checker knows, and `in` takes none.
    if (!resolved.every(arm => arm.kind === "object" && arm.members.length > 0)) return `out += spellValue(${x});`;
    const shapes = resolved as Extract<Description, { kind: "object" }>[];
    for (const candidate of shapes[0].members) {
      const values = shapes.map(
        shape =>
          shape.members.find(
            member => member.name === candidate.name && !member.optional && member.type.kind === "literal",
          )?.type as Extract<Description, { kind: "literal" }> | undefined,
      );
      if (
        values.some(value => value === undefined) ||
        new Set(values.map(value => value!.value)).size !== values.length
      )
        continue;
      const place = `${x}[${JSON.stringify(candidate.name)}]`;
      return `switch (${place}) { ${shapes.map((_, at) => `case ${JSON.stringify(values[at]!.value)}: { ${read(objects[at], x, level + 1, suffix)} break; }`).join(" ")} }`;
    }
    const tests: string[] = [];
    for (let at = 0; at < shapes.length - 1; at++) {
      const own = shapes[at].members.find(
        member =>
          !member.optional &&
          !(member.name in {}) &&
          shapes.every((other, index) => index === at || !other.members.some(theirs => theirs.name === member.name)),
      );
      if (!own) return `out += spellValue(${x});`;
      tests.push(`${JSON.stringify(own.name)} in ${x}`);
    }
    return shapes
      .map(
        (_, at) => (at < tests.length ? `if (${tests[at]}) ` : "") + `{ ${read(objects[at], x, level + 1, suffix)} }`,
      )
      .join(" else ");
  }

  for (self = 0; self < count; self++) {
    usesSelf = false;
    const drawn = random.weighted<() => Description>([
      [10, () => object(0)],
      [3, () => ({ kind: "array", of: object(1) })],
      [4, () => union(0)],
      [4, recursive],
      [5, () => typeAt(0)],
    ])();
    // `any` and `unknown` expect nothing.
    const description: Description = drawn.kind === "anything" ? { kind: "array", of: drawn } : drawn;
    current = description;
    descriptions.push(description);
    const type = write(description, false);
    declarations.push(`type T${self} = ${type};`);
    // Some types are only ever read in part, by typed code that hands the value to nobody.
    const inPart = !usesSelf && !mentionsNamed(description) && random.chance(0.3);
    portion = inPart ? random.pick([0, 0.2, 0.5]) : 1;
    const body = read(description, "value", 0, "\u00a7");
    portion = 1;
    for (const [suffix, parameter] of [
      ["", "T" + self],
      ["u", "any"],
    ])
      declarations.push(
        `function read${self}${suffix}(value: ${parameter}): string { let out = ""; ${body.replaceAll("\u00a7", suffix)} return out; }`,
      );
    const head = `  { name: "T${self}", type: ${JSON.stringify(type)}, description: descriptions[${self}],`;
    const parsed = `JSON.parse(text) as T${self}`;
    if (inPart) {
      cases.push(`${head} inPart: text => read${self}(${parsed}), readUntyped: read${self}u },`);
      continue;
    }
    shareable.push(self);
    const revived = Object.keys(revivers)
      .map(name => `[${JSON.stringify(name)}, text => JSON.parse(text, revivers[${JSON.stringify(name)}]) as T${self}]`)
      .join(", ");
    const parsers = [
      `["a cast", text => ${parsed}]`,
      `["a variable of the type", text => { const held: T${self} = JSON.parse(text); return held; }]`,
      `["a cast in a generator", text => { for (const held of (function* () { yield none; yield ${parsed}; })()) if (held !== none) return held; }]`,
      `["a cast with a reviver", text => JSON.parse(text, (_, held) => held) as T${self}]`,
    ].join(", ");
    const request = `new Request("http://localhost/", { method: "POST", body: bytes })`;
    cases.push(
      `${head} parseLater: async text => { await null; return ${parsed}; }, revived: [${revived}], parsers: [${parsers}], serve: async request => read${self}((await request.json()) as T${self}), readChanged: (text, change) => { const value = ${parsed}; change(value); return read${self}(value); }, readCast: text => read${self}(${parsed}), readBody: async bytes => read${self}((await new Response(bytes).json()) as T${self}), readRequest: async bytes => read${self}((await ${request}.json()) as T${self}), readUntyped: read${self}u },`,
    );
  }

  return `// texts-for-generated-types.ts --print ${seed} --types ${count}
import type { int32 } from "bun";
import { revivers, run, spellValue, type Case, type Description } from "./texts-for-generated-types-driver";

const none = Symbol();
${enums.join("\n")}
${declarations.join("\n")}

const descriptions: Description[] = ${JSON.stringify(descriptions)};
const cases: Case[] = [
${cases.join("\n")}
];
await run(cases, descriptions);
`;
}

if (import.meta.main) {
  const option = (name: string, otherwise: string): string => {
    const at = process.argv.indexOf("--" + name);
    return at < 0 ? otherwise : process.argv[at + 1];
  };
  const types = Number(option("types", "40"));
  if (process.argv.includes("--print")) {
    console.log(program(Number(option("print", "1")), types));
    process.exit(0);
  }
  const out = option("out", "/tmp/texts-for-generated-types");
  const bun = option("bun", process.execPath);
  const until = Date.now() + Number(option("seconds", "60")) * 1000;
  const runSeconds = option("run-seconds", "20");
  // Several sets of flags, with ";" between them: each program is built with one of them, in turn.
  const flagSets = option("flags", "")
    .split(";")
    .map(set => set.split(" ").filter(Boolean));
  const growth = process.argv.includes("--growth");
  const full = process.argv.includes("--full-heap");
  const workers = process.argv.includes("--workers");
  const stress = option("stress", "").split(",").filter(Boolean);
  const limit = Number(option("limit-seconds", "0")) || Number(runSeconds) * 6 + 120;
  let seed = Number(option("seed", "1"));
  let programs = 0,
    texts = 0,
    findings = 0,
    outOfMemory = 0;
  mkdirSync(join(out, "findings"), { recursive: true });

  const environment = {
    ...process.env,
    BUN_ENABLE_CRASH_REPORTING: "0",
    DO_NOT_TRACK: "1",
    ASAN_OPTIONS:
      process.env.ASAN_OPTIONS ??
      "detect_leaks=0:allocator_may_return_null=1:allow_user_segv_handler=1:abort_on_error=0",
  };
  async function command(
    argv: string[],
    cwd: string,
    seconds: number,
    more: Record<string, string> = {},
  ): Promise<{ stdout: string; stderr: string; ended: string }> {
    const child = spawn(argv, {
      cwd,
      env: { ...environment, ...more },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    let late = false;
    const timer = setTimeout(() => ((late = true), child.kill("SIGKILL")), seconds * 1000);
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await child.exited;
    clearTimeout(timer);
    return {
      stdout,
      stderr,
      ended: late
        ? "after " + seconds + " s it had not ended"
        : child.signalCode
          ? "signal " + child.signalCode
          : "exit " + child.exitCode,
    };
  }

  async function one(mine: number): Promise<void> {
    const folder = join(out, "work", String(mine));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "program.ts"), program(mine, types));
    cpSync(
      join(import.meta.dir, "texts-for-generated-types-driver.ts"),
      join(folder, "texts-for-generated-types-driver.ts"),
    );
    writeFileSync(
      join(folder, "tsconfig.json"),
      '{ "compilerOptions": { "strict": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler" } }',
    );
    let said = "";
    let bad = false;
    // Four Workers at a time run the program; each is ended after a few milliseconds, wherever it stands.
    if (workers)
      writeFileSync(
        join(folder, "start.ts"),
        `const seconds = Number(process.argv[process.argv.indexOf("--seconds") + 1]);
const until = Date.now() + seconds * 1000;
let started = 0;
let state = ${mine};
const next = (): number => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 8;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (Date.now() < until) {
      const worker = new Worker("./program.ts", { argv: ["--seed", String(next()), "--seconds", "30"] });
      started++;
      await new Promise(resolve => setTimeout(resolve, next() % [4, 30, 120, 400][next() % 4]));
      await worker.terminate();
    }
  }),
);
console.log("texts " + started + " differences 0");
`,
      );
    const entry = workers ? "./start.ts" : "./program.ts";
    const built = await command(
      [bun, "build", "--compile", "--aot", ...flagSets[mine % flagSets.length], entry, "--outfile", "./program"],
      folder,
      1800,
    );
    if (built.ended !== "exit 0") {
      said = "the build: " + built.ended + "\n" + built.stdout.slice(-4000) + built.stderr.slice(-8000);
      bad = true;
    }
    if (!bad) {
      // A collection at every n-th allocation that leaves the fast path; what it frees is overwritten.
      const interval = stress.length ? stress[mine % stress.length] : "0";
      const collections: Record<string, string> =
        interval === "0"
          ? {}
          : {
              BUN_JSC_slowPathAllocsBetweenGCs: interval,
              BUN_JSC_scribbleFreeCells: "1",
              BUN_JSC_useZombieMode: "1",
              ...(mine & 1 ? { BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1" } : {}),
            };
      const ran = await command(
        [
          "./program",
          "--seed",
          String(mine),
          "--seconds",
          runSeconds,
          ...(growth ? ["--growth"] : []),
          ...(full ? ["--fill"] : []),
        ],
        folder,
        limit,
        { ...collections, ...(full ? { BUN_JSC_markedBlockCageSizeInMB: "64" } : {}) },
      );
      const last = ran.stdout.trimEnd().split("\n").at(-1) ?? "";
      const total = /^texts (\d+) .*differences 0$/.exec(last);
      if (total) texts += Number(total[1]);
      // Where no error can be thrown, a program whose heap is full stops and says so.
      const gaveUp = full && /^FATAL: out of memory/m.test(ran.stderr) && !/Sanitizer|ASSERT/.test(ran.stderr);
      if (gaveUp) outOfMemory++;
      else if (
        !total ||
        ran.ended !== "exit 0" ||
        ran.stderr.replaceAll("Error while printing Error-like object: WorkerTerminated", "").trim() !== "" ||
        ran.stdout.includes("DIFFERS")
      ) {
        bad = true;
        said = "the run: " + ran.ended + "\n" + ran.stdout.slice(-60000) + "\n--- stderr\n" + ran.stderr.slice(-20000);
        const counted = /^texts (\d+) /.exec(last);
        if (counted) texts += Number(counted[1]);
      }
    }
    programs++;
    if (bad) {
      findings++;
      const kept = join(out, "findings", String(mine));
      rmSync(kept, { recursive: true, force: true });
      mkdirSync(kept, { recursive: true });
      cpSync(join(folder, "program.ts"), join(kept, "program.ts"));
      writeFileSync(join(kept, "said.txt"), "flags: " + flagSets[mine % flagSets.length].join(" ") + "\n" + said);
      console.log("seed " + mine + ": " + said.split("\n").slice(0, 3).join(" | ").slice(0, 600));
    }
    rmSync(folder, { recursive: true, force: true });
  }

  await Promise.all(
    Array.from({ length: Number(option("jobs", "4")) }, async () => {
      while (Date.now() < until) await one(seed++);
    }),
  );
  console.log(
    "programs " +
      programs +
      " types " +
      programs * types +
      " texts " +
      texts +
      " findings " +
      findings +
      (full ? " stopped for want of memory " + outOfMemory : "") +
      " next seed " +
      seed,
  );
}
