// Small programs about one object that is handed to no function of the program: the compiler sees everything that is done to it. Every line is printed at once, by `console.log` itself.
//
//   the object  a literal, an instance of a class with fields, a list of whole numbers, of fractions, of texts; with written types or without
//   changed by  stores by name, under a constant key and under a key in a variable, `+=`, `++`, `delete`, new members; `Object.assign`, `defineProperty`, `freeze`, `seal`, `preventExtensions`,
//               `setPrototypeOf`, `Reflect.set`, `deleteProperty`; methods and setters of the object; `push`, `pop`, `shift`, `unshift`, `sort`, `reverse`, `fill`, `splice`, `copyWithin`, `length`;
//               another name for the same object, a list and an object that hold it; a function written where a built-in takes one: a mapper, a comparator, `toJSON`, `valueOf`, a replacer of texts,
//               a getter, a trap, an iterator; a built-in that writes into the object because a species constructor or `call` hands it over
//   a copy      made ahead of the changes by a spread, `slice`, `Object.assign`, `structuredClone` and sixteen more ways, or an object below the object; read and changed beside the object
//   read        by name, under a key, `typeof`, `in`, `Object.hasOwn`, `Object.keys`, `JSON.stringify`, `length`, an element, in sums and templates
//   together    the change and the reads stand in one call, one sum, one template, one list, one comparison, on both sides of the change, in a condition, in a loop, in `try`, in the next statement
//   where       the top of the file, a function called once, a function called three times, an async function behind an `await`, a generator
import type { Random } from "./random";

export function generate(random: Random, isTyped: boolean): string {
  const kind = random.weighted([
    [4, "literal"],
    [4, "instance"],
    [2, "whole numbers"],
    [1, "fractions"],
    [1, "texts"],
  ] as const);
  const isList = kind !== "literal" && kind !== "instance";
  const t = (type: string) => (isTyped ? `: ${type}` : "");
  const any = isTyped ? " as any" : "";
  const number = () => random.pick(["2", "7", "0", "-1", "1.5", "-0", "2 ** 31", "NaN", "0.25"]);
  const text = () => random.pick(['"u"', '""', '"longer text"', "`t${1}`"]);
  const element = () =>
    kind === "texts"
      ? text()
      : kind === "fractions"
        ? random.pick(["4.5", "0.5", "-2.25", "3"])
        : isTyped
          ? random.pick(["4", "9", "-3", "0"])
          : random.pick(["4", "9", "1.5", '"x"', "undefined"]);
  /** A value for the member, of its written type where there are types. */
  const valueOf = (member: string) =>
    isTyped
      ? member === "b"
        ? text()
        : number()
      : random.pick([number(), text(), "null", "undefined", "true", number()]);
  const member = () => random.pick(["a", "a", "b", "c"]);

  // How the two members of the literal are written.
  const [first, fields] = random.pick<[string, string]>([
    ["", `a: 1,\nb: "t"`],
    ["", `a: 1,\nb: "t"`],
    ["", `["a"]: 1,\nb: "t"`],
    isTyped ? ["", `a: 1,\nb: "t"`] : ["", `...{ a: 1 },\nb: "t"`],
    ["", `b: "t",\na: 1`],
    [`const a = 1,\nb = "t";\n`, `a,\nb`],
    isTyped ? ["", `a: 1,\nb: "t"`] : ["", `a: 0,\nb: "t",\na: 1`],
    isTyped ? ["", `a: 2 - 1,\nb: "t"`] : ["", `__proto__: { c: 9, e: 10 },\na: 1,\nb: "t"`],
    isTyped ? ["", `a: 1.5,\nb: "t"`] : ["", `a: 1,\n0: "zero",\nb: "t"`],
  ]);
  const declared = {
    literal: `${isTyped ? "type Held = { a: number; b: string; c?: number; set(given: number): number; get twice(): number; set both(given: number) };\n" : ""}${first}const o${t("Held")} = {\n${fields},\nset(given${t("number")}) {\nthis.a = given;\nreturn given;\n},\nget twice() {\nreturn this.a * 2;\n},\nset both(given${t("number")}) {\nthis.a = given;\nthis.c = given;\n},\n};`,
    instance: random.pick([
      `class Held {\na${t("number")} = 1;\nb${t("string")} = "t";\nc${isTyped ? "?: number" : ""};\nset(given${t("number")}) {\nthis.a = given;\nreturn given;\n}\nget twice() {\nreturn this.a * 2;\n}\nset both(given${t("number")}) {\nthis.a = given;\nthis.c = given;\n}\n}\nconst o = new Held();`,
      `class Above {\na${t("number")} = 1;\nc${isTyped ? "?: number" : ""};\nset(given${t("number")}) {\nthis.a = given;\nreturn given;\n}\n}\nclass Held extends Above {\nb${t("string")} = "t";\nget twice() {\nreturn this.a * 2;\n}\nset both(given${t("number")}) {\nthis.a = given;\nthis.c = given;\n}\n}\nconst o = new Held();`,
      `class Held {\n${isTyped ? "a: number;\nb: string;\nc?: number;\n" : ""}constructor(first${t("number")}) {\nthis.a = first;\nthis.b = "t";\n}\nset(given${t("number")}) {\nthis.a = given;\nreturn given;\n}\nget twice() {\nreturn this.a * 2;\n}\nset both(given${t("number")}) {\nthis.a = given;\nthis.c = given;\n}\n}\nconst o = new Held(1);`,
      isTyped
        ? `class Held {\nconstructor(\npublic a = 1,\npublic b = "t",\npublic c?: number,\n) {}\nset(given${t("number")}) {\nthis.a = given;\nreturn given;\n}\nget twice() {\nreturn this.a * 2;\n}\nset both(given${t("number")}) {\nthis.a = given;\nthis.c = given;\n}\n}\nconst o = new Held();`
        : `function Held() {\nthis.a = 1;\nthis.b = "t";\n}\nHeld.prototype.set = function (given) {\nthis.a = given;\nreturn given;\n};\nObject.defineProperty(Held.prototype, "twice", {\nget() {\nreturn this.a * 2;\n},\n});\nObject.defineProperty(Held.prototype, "both", {\nset(given) {\nthis.a = given;\nthis.c = given;\n},\n});\nconst o = new Held();`,
      `class Held {\n#a${t("number")} = 1;\nget a() {\nreturn this.#a;\n}\nset a(given${t("number")}) {\nthis.#a = given;\n}\nb${t("string")} = "t";\nc${isTyped ? "?: number" : ""};\nset(given${t("number")}) {\nthis.a = given;\nreturn given;\n}\nget twice() {\nreturn this.a * 2;\n}\nset both(given${t("number")}) {\nthis.a = given;\nthis.c = given;\n}\n}\nconst o = new Held();`,
      `function make(first${t("number")}) {\nreturn {\na: first,\nb: "t",\nc: undefined${isTyped ? " as number | undefined" : ""},\nset(given${t("number")}) {\nthis.a = given;\nreturn given;\n},\nget twice() {\nreturn this.a * 2;\n},\nset both(given${t("number")}) {\nthis.a = given;\nthis.c = given;\n},\n};\n}\nconst o = make(1);`,
    ]),
    "whole numbers": `const o${t("number[]")} = [1, 2, 3];`,
    fractions: `const o${t("number[]")} = [1.5, 2.5, 3.5];`,
    texts: `const o${t("string[]")} = ["p", "q", "r"];`,
  }[kind];

  // A copy of the object, made ahead of the changes: it knows nothing of them, and the object knows nothing of what is done to the copy.
  const copied = isList
    ? random.pick([
        "[...o]",
        "o.slice()",
        "Array.from(o)",
        "o.concat()",
        "o.map(each => each)",
        "structuredClone(o)",
        "o.toSorted()",
        "o.toReversed()",
        "o.filter(() => true)",
        "JSON.parse(JSON.stringify(o))",
        "Object.assign([], o)",
        "o.with(0, o[0])",
      ])
    : random.pick([
        "{ ...o }",
        "Object.assign({}, o)",
        "JSON.parse(JSON.stringify(o))",
        "{ a: o.a, b: o.b, c: o.c }",
        "Object.fromEntries(Object.entries(o))",
        "Object.create(o)",
        "{ __proto__: o }",
        "(({ set, ...rest }) => rest)(o)",
      ]);
  const hasCopy = random.chance(0.35);
  const read = (): string => `(${hasCopy && random.chance(0.4) ? drawRead().replace(/\bo\b/g, "copy") : drawRead()})`;
  const drawRead = (): string =>
    isList
      ? random.pick([
          "o[0]",
          "o[1]",
          "o[2]",
          "o.length",
          "o.length",
          "typeof o[0]",
          "o.join()",
          "o[o.length - 1]",
          "0 in o",
          "o.at(-1)",
          "JSON.stringify(o)",
          "o.includes(o[0])",
          "o.indexOf(o[1])",
          "Object.keys(o).join()",
          `o[3]`,
          "Object.isFrozen(o)",
        ])
      : random.pick([
          "o.a",
          "o.a",
          "o.b",
          "o.c",
          "typeof o.a",
          "typeof o.c",
          '"a" in o',
          '"c" in o',
          'Object.hasOwn(o, "c")',
          "Object.keys(o).join()",
          "JSON.stringify(o)",
          "o.twice",
          'o["a"]',
          "o.a + 1",
          "o.b.length",
          "o.c === undefined",
          "Object.isFrozen(o)",
          `(o${any}).d`,
        ]);

  /** An expression that changes the object and answers with something that can be printed. */
  const inner = (): string => {
    if (isList)
      return random.pick([
        `o[0] = ${element()}`,
        `o.push(${element()})`,
        `o.length = 1`,
        `o[1] = ${element()}`,
        `o.pop()`,
      ]);
    const name = member();
    return `o.${name} = ${valueOf(name)}`;
  };
  const change = (): string => (hasCopy && random.chance(0.25) ? drawChange().replace(/\bo\b/g, "copy") : drawChange());
  const drawChange = (): string =>
    random.weighted<() => string>([
      [isList ? 0 : 6, (name = member()) => `(o.${name} = ${valueOf(name)})`],
      [isList ? 0 : 2, (name = member()) => `(o["${name}"] = ${valueOf(name)})`],
      [isList || isTyped ? 0 : 2, (name = member()) => `(o[key] = ${valueOf(name)})`],
      [
        isList ? 0 : 2,
        () =>
          random.pick([
            "(o.a += 1)",
            "o.a++",
            "++o.a",
            "(o.a *= 2)",
            '(o.b += "!")',
            "(o.a -= 0.5)",
            "(o.c ??= 5)",
            "(o.c ||= 6)",
          ]),
      ],
      [isList ? 0 : 3, () => `delete o.c`],
      [isList || isTyped ? 0 : 2, () => `delete o.${member()}`],
      [isList ? 0 : 1, () => `((o${any}).d = ${number()})`],
      [isList ? 0 : 2, (name = member()) => `Object.keys(Object.assign(o, { ${name}: ${valueOf(name)} })).length`],
      [isList ? 0 : 1, () => `Object.keys(Object.assign(o, { a: ${valueOf("a")}, c: ${valueOf("c")} })).length`],
      [
        isList ? 0 : 2,
        (name = member()) =>
          `(Object.defineProperty(o, "${name}", { value: ${valueOf(name)}, writable: true, enumerable: true, configurable: true }) === o)`,
      ],
      [
        isList ? 0 : 1,
        () => `(Object.defineProperty(o, "a", { get: () => 42, enumerable: true, configurable: true }) === o)`,
      ],
      [isList ? 0 : 1, () => `(Object.defineProperty(o, "a", { enumerable: false }) === o)`],
      [2, () => `(Object.${random.pick(["freeze", "seal", "preventExtensions"])}(o) === o)`],
      [isList ? 0 : 1, () => `(Object.setPrototypeOf(o, { c: 77, d: 88 }) === o)`],
      [isList ? 0 : 2, (name = member()) => `Reflect.set(o, "${name}", ${valueOf(name)})`],
      [isList ? 0 : 1, () => `Reflect.deleteProperty(o, "c")`],
      [isList ? 0 : 3, () => `o.set(${number()})`],
      [isList ? 0 : 2, () => `(o.both = ${number()})`],
      [
        isList ? 5 : 0,
        () =>
          random.pick([
            `o.push(${element()})`,
            "o.pop()",
            "o.shift()",
            `o.unshift(${element()})`,
            "o.reverse().length",
            "o.sort().length",
            `o.fill(${element()}).length`,
            "o.splice(0, 1).length",
            `o.splice(1, 0, ${element()}).length`,
            "o.copyWithin(0, 1).length",
          ]),
      ],
      [
        isList ? 4 : 0,
        () =>
          random.pick([
            `(o[0] = ${element()})`,
            `(o[1] = ${element()})`,
            `(o[o.length] = ${element()})`,
            `(o[5] = ${element()})`,
            "(o.length = 0)",
            "(o.length = 1)",
            "(o.length = 5)",
            "delete o[0]",
            "delete o[2]",
          ]),
      ],
      [2, () => `(alias${isList ? `[0] = ${element()}` : `.a = ${valueOf("a")}`})`],
      [1, () => `(inList[0]${isList ? `[0] = ${element()}` : `.a = ${valueOf("a")}`})`],
      [1, () => `(inObject.held${isList ? `[0] = ${element()}` : `.a = ${valueOf("a")}`})`],
      [
        6,
        () =>
          random
            .pick([
              `[1].map(() => (${inner()})).length`,
              `[1, 2].forEach(() => {\n${inner()};\n})`,
              `[2, 1].sort(() => {\n${inner()};\nreturn 0;\n}).length`,
              `[1].filter(() => (${inner()}, true)).length`,
              `[1, 2].reduce(sum => {\n${inner()};\nreturn sum;\n}, 0)`,
              `JSON.stringify({\ntoJSON() {\n${inner()};\nreturn 1;\n},\n})`,
              `+{\nvalueOf() {\n${inner()};\nreturn 1;\n},\n}`,
              `\`\${{\ntoString() {\n${inner()};\nreturn "s";\n},\n}}\``,
              `"x".replace(/x/, () => {\n${inner()};\nreturn "y";\n})`,
              `{\nget g() {\n${inner()};\nreturn 1;\n},\n}.g`,
              `(new Proxy({}, {\nget() {\n${inner()};\nreturn 1;\n},\n})${any}).p`,
              `[\n...{\n*[Symbol.iterator]() {\n${inner()};\nyield 1;\n},\n},\n].length`,
              `Array.from({ length: 1 }, () => (${inner()})).length`,
              `new Map([[1, 1]]).forEach(() => {\n${inner()};\n})`,
              `JSON.parse("[1]", (name, each) => {\n${inner()};\nreturn each;\n}).length`,
              `(() => {\ntry {\n${inner()};\nthrow 1;\n} catch {\nreturn 0;\n}\n})()`,
              `(() => (${inner()}))()`,
            ])
            .replace(/^\{/, "({")
            .replace(/^(\(\{[\s\S]*\})\.g$/, "$1).g"),
      ],
      [
        isList ? 3 : 0,
        () =>
          random.pick([
            `Array.prototype.push.call(o, ${element()})`,
            "Array.prototype.reverse.call(o).length",
            `(Array.from${any}).call(function () {\nreturn o;\n}, [${element()}]).length`,
            `(Array.of${any}).call(function () {\nreturn o;\n}, ${element()}).length`,
            `(() => {\nconst from${t("any")} = [8, 9];\nfrom.constructor = { [Symbol.species]: function () {\nreturn o;\n} };\nreturn from.map((each${t("any")}) => each).length;\n})()`,
          ]),
      ],
    ])();

  const together = (): string => {
    const c = change();
    const r = read;
    return random.pick<() => string>([
      () => `console.log(${c}, ${r()});`,
      () => `console.log(${r()}, ${c}, ${r()});`,
      () => `console.log(${c} + " " + ${r()});`,
      () => `console.log(${r()} + " " + ${c} + " " + ${r()});`,
      () => `console.log(\`\${${r()}} \${${c}} \${${r()}}\`);`,
      (same = r()) => `console.log(String(${same}) + ${c} + String(${same}));`,
      (same = r()) => `console.log([${same}, ${c}, ${same}].join(" "));`,
      (same = r()) => `{\nconst before = ${same};\nconst answer = ${c};\nconsole.log(before, answer, ${same});\n}`,
      () => `${c};\nconsole.log(${r()}, ${r()});`,
      () => `if (${isTyped ? `(${c}) as unknown` : c}) console.log("then", ${r()});\nelse console.log("else", ${r()});`,
      (same = r()) => `for (let turn = 0; turn < 3; turn++) console.log(turn, ${same}, ${c}, ${same});`,
      (same = r()) =>
        `try {\nconsole.log(${same}, ${c}, ${same});\n} catch (error) {\nconsole.log("THROWS", (error${any}).constructor.name, ${same});\n}`,
      (same = r()) => `console.log(${same} === ${same}, ${c}, ${same});`,
      (same = r()) => `console.log(${same}, flag ? ${c} : "not taken", ${same});`,
      (same = r()) =>
        `{\nlet seen = "";\nfor (let turn = 0; turn < 2; turn++) {\nseen += ${same} + ",";\nif (turn === 0) ${c};\n}\nconsole.log(seen, ${same});\n}`,
    ])();
  };

  const body = [
    declared,
    `const alias = o;\nconst inList = [o];\nconst inObject = { held: o };`
      .split("\n")
      .filter(() => random.chance(0.4))
      .join("\n"),
    hasCopy ? `const copy${t("any")} = ${copied};` : "",
    `console.log(${read()}, ${read()});`,
    ...Array.from({ length: random.between(1, 5) }, together),
    `console.log(${isList ? "o.length, o.join(), Object.keys(o).join()" : "o.a, o.b, o.c, Object.keys(o).join(), JSON.stringify(o)"});`,
  ].join("\n");
  // Names that a change may use are declared whether they were drawn or not.
  const names = ["alias = o", "inList = [o]", "inObject = { held: o }"].filter(
    each => !body.includes(`const ${each}`) && body.includes(each.split(" ")[0]),
  );
  const whole = body.replace(declared, `${declared}\n${names.map(each => `const ${each};`).join("\n")}`);
  const guarded = `try {\n${whole}\n} catch (error) {\nconsole.log("THROWS", (error${any}).constructor.name);\n}`;
  const top = `let flag${t("boolean")} = true;\nlet key${t("string")} = "a";\n`;
  const place = random.pick(["top", "top", "once", "thrice", "async", "generator"] as const);
  const end = isTyped ? "export {};\n" : "";
  if (place === "top") return `${top}${guarded}\n${end}`;
  if (place === "once") return `${top}function run() {\n${guarded}\n}\nrun();\n${end}`;
  if (place === "thrice")
    return `${top}function run() {\n${guarded}\n}\nrun();\nflag = false;\nkey = "c";\nrun();\nrun();\n${end}`;
  if (place === "async") return `${top}async function run() {\nawait null;\n${guarded}\n}\nawait run();\n${end}`;
  return `${top}function* run() {\nyield 1;\n${guarded}\n}\nfor (const step of run()) console.log("step", step);\n${end}`;
}
