// Small programs about one value of a built-in class for which one member of that class is replaced, in one way, and which is then used where the language asks that member: by the call itself, and by
// spreads, loops, patterns, conversions, `await`, JSON and other built-ins. What replaces the member tells that it ran. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the value    a list, a map, a set, a promise, a regular expression, a text object, a number object, a date, an error, a list of bytes, a function, an iterator of a list, a generator
//   the member   methods, getters and the members under well-known symbols that built-ins and the language ask for
//   replaced by  a class below the built-in class, a class two below it, a member stored on the `prototype` of such a class later, a member stored on the value, `Object.assign`, definitions,
//                another prototype for the value
//   when         ahead of every use, or between two uses
//   with types   half of the programs: the variable is declared as the built-in type
import type { Random } from "./random";

type Member = { key: string; kind?: "*" | "get "; parameters?: string; body: string; uses: string[] };
type Kind = { base: string; type: string; given: string; literal?: string; argument?: string; members: Member[] };

const iterates = (yields: string): Member => ({
  key: "[Symbol.iterator]",
  kind: "*",
  body: `log += "iterates ";\nyield ${yields};`,
  uses: [],
});
const kinds: Kind[] = [
  {
    base: "Array",
    type: "number[]",
    argument: "<number>",
    given: "1, 2, 3",
    literal: "[1, 2, 3]",
    members: [
      {
        key: "push",
        parameters: "...given",
        body: `log += "push ";\nreturn Array.prototype.push.apply(this, given);`,
        uses: ["v.push(4)", "[v.push(4), v.length].join()"],
      },
      {
        key: "map",
        parameters: "mapper",
        body: `log += "map ";\nreturn [7];`,
        uses: ["v.map(String).join()"],
      },
      {
        ...iterates("7"),
        uses: [
          "[...v].join()",
          "Array.from(v).join()",
          "Math.max(...v)",
          "new Set(v).size",
          "((...rest) => rest.length)(...v)",
          "(([first]) => first)(v)",
          "[0].concat(v).join()",
          "v.join()",
          "new Uint8Array(v).length",
          "Object.keys(v).join()",
        ],
      },
      {
        key: "join",
        parameters: "between",
        body: `log += "join ";\nreturn "joined";`,
        uses: ["String(v)", "`${v}`", 'v + ""', "v.toString()", '[v, 1].join("|")', "v.join()"],
      },
      {
        key: "toString",
        body: `log += "toString ";\nreturn "as text";`,
        uses: ["String(v)", "`${v}`", 'v + ""', "[v].join()", "v.join()"],
      },
      {
        key: "includes",
        parameters: "given",
        body: `log += "includes ";\nreturn "answered";`,
        uses: ["v.includes(2)"],
      },
      {
        key: "forEach",
        parameters: "visitor",
        body: `log += "forEach ";`,
        uses: ['v.forEach(() => console.log("visited"))'],
      },
      { key: "slice", body: `log += "slice ";\nreturn [7];`, uses: ["v.slice(1).join()", "[...v.slice()].length"] },
      {
        key: "toJSON",
        body: `log += "toJSON ";\nreturn "as json";`,
        uses: ["JSON.stringify(v)", "JSON.stringify({ held: v })", "JSON.stringify([v])"],
      },
      {
        key: "[Symbol.isConcatSpreadable]",
        kind: "get ",
        body: `log += "asked ";\nreturn false;`,
        uses: ["[0].concat(v).length", "v.concat([0]).length"],
      },
      {
        key: '["constructor"]',
        kind: "get ",
        body: `log += "constructor ";\nreturn undefined;`,
        uses: [
          "v.map(each => each).length",
          "v.filter(each => each > 1).length",
          "v.slice().length",
          "v.concat([1]).length",
          "v.flat().length",
        ],
      },
      { key: "at", parameters: "index", body: `log += "at ";\nreturn "own";`, uses: ["v.at(0)", "v.at(-1)"] },
      {
        key: "entries",
        kind: "*",
        body: `log += "entries ";\nyield [9, 9];`,
        uses: ["[...v.entries()].join()", "Object.fromEntries(v.entries())[9]"],
      },
      {
        key: "values",
        kind: "*",
        body: `log += "values ";\nyield 9;`,
        uses: ["[...v.values()].join()", "[...v].join()"],
      },
      { key: "indexOf", parameters: "given", body: `log += "indexOf ";\nreturn 99;`, uses: ["v.indexOf(2)"] },
      {
        key: "sort",
        body: `log += "sort ";\nreturn this;`,
        uses: ["v.sort().join()", "v.sort(() => 0).join()"],
      },
    ],
  },
  {
    base: "Map",
    type: "Map<string, number>",
    argument: "<string, number>",
    given: '[["k", 1]]',
    members: [
      { key: "get", parameters: "key", body: `log += "get ";\nreturn 7;`, uses: ['v.get("k")', 'v.get("absent")'] },
      {
        key: "set",
        parameters: "key, value",
        body: `log += "set ";\nreturn Map.prototype.set.call(this, key, 7);`,
        uses: ['v.set("a", 1).size', 'v.get("k")', "[...v].join()"],
      },
      { key: "has", parameters: "key", body: `log += "has ";\nreturn "answered";`, uses: ['v.has("k")'] },
      {
        key: "size",
        kind: "get ",
        body: `log += "size ";\nreturn 7;`,
        uses: ["v.size", "[...v].length", "new Map(v).size"],
      },
      {
        ...iterates('["own", 7]'),
        uses: [
          "[...v].join()",
          "new Map(v).size",
          "Object.fromEntries(v).own",
          "Array.from(v).length",
          "[...v.entries()].join()",
        ],
      },
      {
        key: "entries",
        kind: "*",
        body: `log += "entries ";\nyield ["own", 7];`,
        uses: ["[...v.entries()].join()", "[...v].join()", "new Map(v).size"],
      },
      {
        key: "forEach",
        parameters: "visitor",
        body: `log += "forEach ";`,
        uses: ['v.forEach(() => console.log("visited"))'],
      },
      {
        key: "keys",
        kind: "*",
        body: `log += "keys ";\nyield "own";`,
        uses: ["[...v.keys()].join()", "Array.from(v.keys()).length"],
      },
      {
        key: "delete",
        parameters: "key",
        body: `log += "delete ";\nreturn "answered";`,
        uses: ['[v.delete("k"), Map.prototype.has.call(v, "k")].join()'],
      },
    ],
  },
  {
    base: "Set",
    type: "Set<number>",
    argument: "<number>",
    given: "[1, 2]",
    members: [
      {
        key: "add",
        parameters: "value",
        body: `log += "add ";\nreturn Set.prototype.add.call(this, 7);`,
        uses: ["v.add(3).size", "[...v].join()"],
      },
      {
        key: "has",
        parameters: "value",
        body: `log += "has ";\nreturn false;`,
        uses: [
          "v.has(1)",
          "new Set([1, 9]).intersection(v).size",
          "new Set([1, 9]).difference(v).size",
          "new Set([1]).isSubsetOf(v)",
        ],
      },
      {
        key: "size",
        kind: "get ",
        body: `log += "size ";\nreturn 0;`,
        uses: ["v.size", "new Set([1, 9]).union(v).size", "new Set([1, 9]).intersection(v).size"],
      },
      {
        ...iterates("7"),
        uses: [
          "[...v].join()",
          "new Set(v).size",
          "Array.from(v).join()",
          "Math.max(...v)",
          "new Set([9]).union(v).size",
        ],
      },
      {
        key: "keys",
        kind: "*",
        body: `log += "keys ";\nyield 7;`,
        uses: ["[...new Set([9]).union(v)].join()", "[...v.keys()].join()", "[...v].join()"],
      },
      {
        key: "values",
        kind: "*",
        body: `log += "values ";\nyield 7;`,
        uses: ["[...v.values()].join()", "[...v].join()"],
      },
      {
        key: "forEach",
        parameters: "visitor",
        body: `log += "forEach ";`,
        uses: ['v.forEach(() => console.log("visited"))'],
      },
    ],
  },
  {
    base: "Promise",
    type: "Promise<number>",
    argument: "<number>",
    given: "resolve => resolve(1)",
    members: [
      {
        key: "then",
        parameters: "fulfilled, rejected",
        body: `log += "then ";\nreturn Promise.prototype.then.call(this, () => fulfilled(7), rejected);`,
        uses: [
          "await v",
          "(await Promise.all([v])).join()",
          "await Promise.resolve(v)",
          "await (async () => v)()",
          "await v.finally(() => {})",
          "await v.catch(() => 0)",
          "await Promise.race([v])",
          "await v.then(String)",
          "(await Promise.allSettled([v]))[0].status",
        ],
      },
      {
        key: '["constructor"]',
        kind: "get ",
        body: `log += "constructor ";\nreturn Promise;`,
        uses: ["await v", "Promise.resolve(v) === v", "await v.then(String)", "await v.finally(() => {})"],
      },
      {
        key: "finally",
        parameters: "done",
        body: `log += "finally ";\nreturn this;`,
        uses: ["await v.finally(() => {})"],
      },
      {
        key: "catch",
        parameters: "rejected",
        body: `log += "catch ";\nreturn this;`,
        uses: ["await v.catch(() => 0)"],
      },
    ],
  },
  {
    base: "RegExp",
    type: "RegExp",
    given: '"X", "g"',
    literal: "/X/g",
    members: [
      {
        key: "exec",
        parameters: "text",
        body: `log += "exec ";\nreturn null;`,
        uses: [
          'v.test("aXb")',
          '"aXb".replace(v, "-")',
          '"aXb".match(v)',
          '"aXb".split(v).join()',
          '"aXb".search(v)',
          '[..."aXb".matchAll(v)].length',
          'v.exec("aXb")',
        ],
      },
      { key: "test", parameters: "text", body: `log += "test ";\nreturn "answered";`, uses: ['v.test("aXb")'] },
      {
        key: "[Symbol.replace]",
        parameters: "text, by",
        body: `log += "replace ";\nreturn "replaced";`,
        uses: ['"aXb".replace(v, "-")', '"aXb".replaceAll(v, "-")'],
      },
      {
        key: "[Symbol.match]",
        parameters: "text",
        body: `log += "match ";\nreturn ["own"];`,
        uses: ['"aXb".match(v)?.join()', '"aXb".includes("X")'],
      },
      {
        key: "[Symbol.split]",
        parameters: "text",
        body: `log += "split ";\nreturn ["own"];`,
        uses: ['"aXb".split(v).join()'],
      },
      { key: "[Symbol.search]", parameters: "text", body: `log += "search ";\nreturn 99;`, uses: ['"aXb".search(v)'] },
      {
        key: "flags",
        kind: "get ",
        body: `log += "flags ";\nreturn "";`,
        uses: ['"aXbX".replace(v, "-")', '"aXbX".split(v).length', "v.flags", "String(v)", '"aXbX".match(v)?.length'],
      },
      {
        key: "global",
        kind: "get ",
        body: `log += "global ";\nreturn false;`,
        uses: ["v.flags", '"aXbX".replace(v, "-")', "v.global"],
      },
      { key: "toString", body: `log += "toString ";\nreturn "as text";`, uses: ["String(v)", "`${v}`", 'v + ""'] },
      {
        key: "source",
        kind: "get ",
        body: `log += "source ";\nreturn "own";`,
        uses: ["String(v)", "v.source", "new RegExp(v).source"],
      },
    ],
  },
  {
    base: "String",
    type: "String",
    given: '"st"',
    members: [
      {
        key: "toString",
        body: `log += "toString ";\nreturn "own";`,
        uses: [
          "`${v}`",
          "String(v)",
          "JSON.stringify(v)",
          '"a".concat(v)',
          "[v].join()",
          "Object.keys({ [v]: 1 }).join()",
        ],
      },
      { key: "valueOf", body: `log += "valueOf ";\nreturn "own";`, uses: ['v + ""', 'v == "st"', "`${v}`", 'v < "z"'] },
      { ...iterates('"own"'), uses: ["[...v].join()", "Array.from(v).join()", "new Set(v).size"] },
      {
        key: "[Symbol.toPrimitive]",
        parameters: "hint",
        body: `log += hint + " ";\nreturn "own";`,
        uses: ["`${v}`", 'v + ""', "+v", "JSON.stringify(v)", "Object.keys({ [v]: 1 }).join()"],
      },
      { key: "at", parameters: "index", body: `log += "at ";\nreturn "own";`, uses: ["v.at(0)"] },
      {
        key: "toJSON",
        body: `log += "toJSON ";\nreturn "as json";`,
        uses: ["JSON.stringify(v)", "JSON.stringify([v])"],
      },
    ],
  },
  {
    base: "Number",
    type: "Number",
    given: "1",
    members: [
      {
        key: "valueOf",
        body: `log += "valueOf ";\nreturn 7;`,
        uses: ["v + 1", "v * 2", "JSON.stringify(v)", "Math.max(v, 0)", "v > 5", "+v", "[v].join()"],
      },
      {
        key: "toString",
        body: `log += "toString ";\nreturn "2";`,
        uses: ["`${v}`", "String(v)", "[5, 6, 7][v]", "[v].join()", "v + 1"],
      },
      {
        key: "[Symbol.toPrimitive]",
        parameters: "hint",
        body: `log += hint + " ";\nreturn 2;`,
        uses: ["v + 1", "`${v}`", "[5, 6, 7][v]", "Math.max(v, 0)", "JSON.stringify(v)"],
      },
      { key: "toFixed", parameters: "digits", body: `log += "toFixed ";\nreturn "own";`, uses: ["v.toFixed(1)"] },
    ],
  },
  {
    base: "Date",
    type: "Date",
    given: "0",
    members: [
      { key: "getTime", body: `log += "getTime ";\nreturn 7;`, uses: ["v.getTime()", "+v", "JSON.stringify(v)"] },
      { key: "valueOf", body: `log += "valueOf ";\nreturn 7;`, uses: ["+v", "v - 0", "v > 5", "v.getTime()"] },
      {
        key: "toISOString",
        body: `log += "toISOString ";\nreturn "own";`,
        uses: ["JSON.stringify(v)", "v.toJSON()", "v.toISOString()", "JSON.stringify({ held: v })"],
      },
      {
        key: "toJSON",
        body: `log += "toJSON ";\nreturn "as json";`,
        uses: ["JSON.stringify(v)", "JSON.stringify([v])"],
      },
      {
        key: "[Symbol.toPrimitive]",
        parameters: "hint",
        body: `log += hint + " ";\nreturn 7;`,
        uses: ["+v", "`${v}`", "v + 1", "v - 0"],
      },
      { key: "toString", body: `log += "toString ";\nreturn "own";`, uses: ["`${v}`", 'v + ""', "String(v)"] },
    ],
  },
  {
    base: "Error",
    type: "Error",
    given: '"told"',
    members: [
      { key: "toString", body: `log += "toString ";\nreturn "own";`, uses: ["String(v)", "`${v}`", 'v + ""'] },
      {
        key: "name",
        kind: "get ",
        body: `log += "name ";\nreturn "Own";`,
        uses: ["String(v)", "v.name", "Error.prototype.toString.call(v)"],
      },
      {
        key: "message",
        kind: "get ",
        body: `log += "message ";\nreturn "own";`,
        uses: ["String(v)", "v.message", 'Object.hasOwn(v, "message")'],
      },
      { key: "toJSON", body: `log += "toJSON ";\nreturn "as json";`, uses: ["JSON.stringify(v)"] },
    ],
  },
  {
    base: "Uint8Array",
    type: "Uint8Array",
    given: "[1, 2, 3]",
    members: [
      {
        key: "length",
        kind: "get ",
        body: `log += "length ";\nreturn 1;`,
        uses: [
          "v.length",
          "[...v].length",
          "Array.from(v).length",
          "v.join()",
          "new Uint8Array(v).length",
          "Array.prototype.join.call(v)",
          "Array.prototype.slice.call(v).length",
        ],
      },
      {
        ...iterates("7"),
        uses: [
          "[...v].join()",
          "Array.from(v).join()",
          "new Uint8Array(v).join()",
          "Math.max(...v)",
          "new Set(v).size",
          "v.join()",
        ],
      },
      { key: "join", body: `log += "join ";\nreturn "joined";`, uses: ["String(v)", "v.join()", "`${v}`"] },
      {
        key: '["constructor"]',
        kind: "get ",
        body: `log += "constructor ";\nreturn undefined;`,
        uses: [
          "v.map(each => each).length",
          "v.subarray(1).length",
          "v.slice(1).length",
          "v.filter(each => each > 1).length",
        ],
      },
      { key: "at", parameters: "index", body: `log += "at ";\nreturn "own";`, uses: ["v.at(0)"] },
      { key: "set", parameters: "from", body: `log += "set ";`, uses: ["[v.set([9]), v[0]].join()"] },
      { key: "toJSON", body: `log += "toJSON ";\nreturn "as json";`, uses: ["JSON.stringify(v)"] },
    ],
  },
];

export function generate(random: Random, isTyped = false): string {
  const kind = random.pick(kinds);
  const member = random.pick(kind.members);
  const t = (type: string) => (isTyped ? `: ${type}` : "");
  const parameters = (member.parameters ?? "")
    .split(", ")
    .filter(Boolean)
    .map(each => (isTyped ? each + (each.startsWith("...") ? ": any[]" : "?: any") : each))
    .join(", ");
  const answers = isTyped && member.kind !== "get " ? ": any" : isTyped ? ": any" : "";
  const method = `${member.kind ?? ""}${member.key}(${parameters})${answers} {\n${member.body}\n}`;
  // In a literal and in a function `this` is whatever the call says.
  const self = isTyped ? ["this: any", parameters].filter(Boolean).join(", ") : parameters;
  const inLiteral =
    member.kind === "get " ? method : `${member.kind ?? ""}${member.key}(${self})${answers} {\n${member.body}\n}`;
  const access = member.key.startsWith("[") ? member.key : `.${member.key}`;
  const name = member.key.startsWith("[") ? member.key.slice(1, -1) : JSON.stringify(member.key);
  const loose = isTyped ? "(v as any)" : "v";
  const above = `${kind.base}${isTyped ? (kind.argument ?? "") : ""}`;
  const plain = () => (kind.literal && random.chance(0.6) ? kind.literal : `new ${kind.base}(${kind.given})`);
  const stored =
    member.kind === "get "
      ? (on: string) =>
          `Object.defineProperty(${on}, ${name}, {\nget()${answers} {\n${member.body}\n},\nconfigurable: true,\n});`
      : (on: string) => `${on}${access} = function${member.kind ?? ""} (${self})${answers} {\n${member.body}\n};`;

  const [declared, made, replaces] = random.weighted<[string, string, string]>([
    [5, [`class Mine extends ${above} {\n${method}\n}`, `new Mine(${kind.given})`, ""]],
    [
      2,
      [`class Between extends ${above} {\n${method}\n}\nclass Mine extends Between {}`, `new Mine(${kind.given})`, ""],
    ],
    [
      2,
      [`class Between extends ${above} {}\nclass Mine extends Between {\n${method}\n}`, `new Mine(${kind.given})`, ""],
    ],
    [
      3,
      [
        `class Mine extends ${above} {}`,
        `new Mine(${kind.given})`,
        stored(isTyped ? "(Mine.prototype as any)" : "Mine.prototype"),
      ],
    ],
    [5, ["", plain(), stored(loose)]],
    [member.kind === "get " ? 0 : 2, ["", plain(), `Object.assign(v, {\n${inLiteral},\n});`]],
    [2, ["", plain(), `Object.defineProperties(v, Object.getOwnPropertyDescriptors({\n${inLiteral},\n}));`]],
    [4, ["", plain(), `Object.setPrototypeOf(v, {\n__proto__: ${kind.base}.prototype,\n${inLiteral},\n});`]],
    [1, ["", plain(), `${loose}.__proto__ = {\n__proto__: ${kind.base}.prototype,\n${inLiteral},\n};`]],
  ]);
  // TypeScript takes no object of these three classes as an operand or a key.
  const isLoose = isTyped && ["Number", "String", "Date"].includes(kind.base);
  const use = () =>
    `console.log(${isLoose ? random.pick(member.uses).replace(/\bv\b/g, "(v as any)") : random.pick(member.uses)});`;
  const between = !!replaces && random.chance(0.35);
  const scene = [
    `const v${isTyped && random.chance(0.8) ? `: ${kind.type}` : ""} = ${made};`,
    between ? use() : "",
    replaces,
    use(),
    random.chance(0.5) ? use() : "",
    random.chance(0.2) ? use() : "",
    "console.log(log);",
  ]
    .filter(Boolean)
    .join("\n");
  const waits = /\bawait\b/.test(scene);
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", ${isTyped ? "(error as any)" : "error"}.constructor.name);\n}`;
  const head = `let log = "";${declared ? "\n" + declared : ""}`;
  const end = isTyped || waits ? "export {};\n" : "";
  const place = random.pick(["top", "top", "once", "once", "thrice", "method"] as const);
  const a = waits ? "async " : "";
  const w = waits ? "await " : "";
  if (place === "top") return `${head}\n${guarded(scene)}\n${end}`;
  if (place === "once") return `${head}\n${a}function run() {\n${scene}\n}\n${guarded(`${w}run();`)}\n${end}`;
  if (place === "thrice")
    return `${head}\n${a}function run() {\n${scene}\n}\n${guarded(`${w}run();\n${w}run();\n${w}run();`)}\n${end}`;
  return `${head}\nconst holder = {\n${a}run() {\n${scene}\n},\n};\n${guarded(`${w}holder.run();`)}\n${end}`;
}
