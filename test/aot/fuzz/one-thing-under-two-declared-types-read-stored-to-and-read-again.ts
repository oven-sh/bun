// Small TypeScript programs, which the type checker accepts, about one thing that has two names with two declared types. It is read under one name, stored to under the other and read again in one
// function: the second read sees the store. `readonly`, `as const`, a tuple's length and a type that a test has narrowed say what this name may do, not what another name or a function has done.
// There is one scene, no helper, and every line is printed at once, by `console.log` itself.
//
//   the two types   `Readonly<..>` and the open type, an interface with `readonly` and one without, in either direction; `as const` and the open type; a class with a `readonly` field or
//                   parameter property and an open type; a wide interface and a narrow one; two interfaces or two classes of one shape; a class and an interface; `readonly number[]` and
//                   `number[]`; a tuple and a list; `ReadonlyMap`, `ReadonlySet` and what they are views of
//   narrowed        a member or a variable of a union type behind `typeof`, `!== null`, `!== undefined`, `instanceof`, `in` or a tag, and a store by another name, a function or a closure
//   where           both names in one function, two parameters, a parameter and a function that came in
//   the store       `=`, `++`, `+=`, `Object.assign`, methods of lists, maps and sets, `length`
//   the reads       in two statements, in one call, in a test that is asked again, in the test of a loop, in two turns of a loop, under `typeof`
import type { Random } from "./random";

type Pair = {
  types?: string;
  outside?: string;
  setup: string;
  read: string;
  first: string;
  stores: string[];
  parameters?: string;
  given?: string;
};

export function generate(random: Random): string {
  const value = () => random.pick(["2", "2", "7", "1.5", "-0", "2 ** 31", "NaN"]);
  const stores = (b: string) => [
    `${b}.x = ${value()}`,
    `${b}.x = ${value()}`,
    `${b}.x = ${value()}`,
    `${b}.x++`,
    `${b}.x += 1.5`,
    `Object.assign(${b}, { x: ${value()} })`,
    `${b}["x"] = ${value()}`,
    `[${b}.x] = [${value()}]`,
    `({ x: ${b}.x } = { x: ${value()} })`,
  ];
  const listStores = (b: string) => [
    `${b}.push(4)`,
    `${b}.push(4)`,
    `${b}.pop()`,
    `${b}[0] = 9`,
    `${b}.length = 0`,
    `${b}.reverse()`,
    `${b}.shift()`,
    `${b}.unshift(0)`,
    `${b}.splice(0, 1)`,
    `${b}.fill(5)`,
  ];
  const object = (types: string, setup: string): Pair => ({
    types,
    setup,
    read: "a.x",
    first: "1",
    stores: stores("b"),
  });

  const pairs: [number, () => Pair][] = [
    [4, () => object("type Fixed = Readonly<{ x: number }>;", "const b = { x: 1 };\nconst a: Fixed = b;")],
    [
      3,
      () =>
        object(
          "interface Fixed {\nreadonly x: number;\n}\ninterface Open {\nx: number;\n}",
          "const b: Open = { x: 1 };\nconst a: Fixed = b;",
        ),
    ],
    [
      4,
      () =>
        object(
          "interface Fixed {\nreadonly x: number;\n}\ninterface Open {\nx: number;\n}",
          "const a: Fixed = { x: 1 };\nconst b: Open = a;",
        ),
    ],
    [5, () => object("", "const a = { x: 1 } as const;\nconst b: { x: number } = a;")],
    [2, () => object("", 'const a = { w: "w", x: 1, y: 2.5 } as const;\nconst b: { x: number } = a;')],
    [4, () => object("class Kind {\nreadonly x: number = 1;\n}", "const a = new Kind();\nconst b: { x: number } = a;")],
    [2, () => object("class Kind {\nreadonly x = 1;\n}", "const a = new Kind();\nconst b: { x: number } = a;")],
    [
      3,
      () =>
        object(
          "class Kind {\nconstructor(readonly x: number) {}\n}",
          "const a = new Kind(1);\nconst b: { x: number } = a;",
        ),
    ],
    [
      3,
      () =>
        object(
          "interface Narrow {\nx: number;\n}\ninterface Wide extends Narrow {\ny: string;\n}",
          'const a: Wide = { x: 1, y: "y" };\nconst b: Narrow = a;',
        ),
    ],
    [
      2,
      () =>
        object(
          "interface Narrow {\nx: number;\n}\ninterface Wide extends Narrow {\ny: string;\n}",
          'const b: Wide = { x: 1, y: "y" };\nconst a: Narrow = b;',
        ),
    ],
    [
      2,
      () =>
        object(
          "interface One {\nx: number;\n}\ninterface Other {\nx: number;\n}",
          "const a: One = { x: 1 };\nconst b: Other = a;",
        ),
    ],
    [
      3,
      () =>
        object("class Kind {\nx = 1;\n}\ninterface HasX {\nx: number;\n}", "const a = new Kind();\nconst b: HasX = a;"),
    ],
    [3, () => object("class One {\nx = 1;\n}\nclass Other {\nx = 1;\n}", "const a = new One();\nconst b: Other = a;")],
    [
      2,
      () =>
        object("class One {\nx = 1;\ny = 2;\n}\nclass Other {\nx = 5;\n}", "const a = new One();\nconst b: Other = a;"),
    ],
    [
      4,
      () => ({
        setup: "",
        parameters: random.pick([
          "a: Readonly<{ x: number }>, b: { x: number }",
          "a: { readonly x: number }, b: { x: number }",
          "a: { x: number }, b: { x: number; y?: string }",
        ]),
        given: "one, one",
        outside: "const one = { x: 1 };",
        read: "a.x",
        first: "1",
        stores: stores("b"),
      }),
    ],
    [
      3,
      () => ({
        setup: "",
        parameters: "a: Readonly<{ x: number }>, put: (given: number) => void",
        given: "one, given => {\none.x = given;\n}",
        outside: "const one = { x: 1 };",
        read: "a.x",
        first: "1",
        stores: [`put(${value()})`, `put(${value()})`, `[${value()}].forEach(put)`],
      }),
    ],
    [
      4,
      () => ({
        setup: "const b = [1, 2, 3];\nconst a: readonly number[] = b;",
        read: random.pick(["a.length", "a.length", "a[0]", "a.at(-1)"]),
        first: "3",
        stores: listStores("b"),
      }),
    ],
    [
      1,
      () => ({
        setup: "const b = [1, 2, 3];\nconst a: ReadonlyArray<number> = b;",
        read: random.pick(["a.length", "a[0]"]),
        first: "3",
        stores: listStores("b"),
      }),
    ],
    [
      5,
      () => ({
        setup: "const a: [number, number] = [1, 2];\nconst b: number[] = a;",
        read: random.pick(["a.length", "a.length", "a.length", "a[1]", "a[0]"]),
        first: "2",
        stores: listStores("b"),
      }),
    ],
    [
      2,
      () => ({
        setup: 'const a: [number, string] = [1, "t"];\nconst b: (number | string)[] = a;',
        read: "a.length",
        first: "2",
        stores: ["b.push(4)", "b.pop()", "b.length = 0", "b.shift()"],
      }),
    ],
    [
      3,
      () => ({
        setup: "",
        parameters: "a: readonly number[], add: () => void",
        given: "list, () => {\nlist.push(4);\n}",
        outside: "const list = [1, 2, 3];",
        read: random.pick(["a.length", "a.at(-1)"]),
        first: "3",
        stores: ["add()"],
      }),
    ],
    [
      2,
      () => ({
        setup: "const b = new Map<number, number>([[1, 1]]);\nconst a: ReadonlyMap<number, number> = b;",
        read: random.pick(["a.get(1)", "a.size", "a.has(1)"]),
        first: "1",
        stores: ["b.set(1, 2)", "b.delete(1)", "b.clear()", "b.set(2, 2)"],
      }),
    ],
    [
      1,
      () => ({
        setup: "const b = new Set<number>([1]);\nconst a: ReadonlySet<number> = b;",
        read: random.pick(["a.size", "a.has(1)"]),
        first: "1",
        stores: ["b.add(2)", "b.delete(1)", "b.clear()"],
      }),
    ],
  ];

  // What a test has narrowed, and a store that the test does not see.
  const narrowed: [number, string][] = [
    [
      3,
      'const a: { x: number | string } = { x: 1 };\nconst b = a;\nif (typeof a.x === "number") {\nb.x = "t";\nconsole.log(a.x + 1);\n}',
    ],
    [
      3,
      'const a: { x: number | string } = { x: 1 };\nconst put = () => {\na.x = "t";\n};\nif (typeof a.x === "number") {\nput();\nconsole.log(a.x + 1);\n}',
    ],
    [
      2,
      'const a: { x: number | string } = { x: 1 };\nconst put = () => {\na.x = "t";\n};\nif (typeof a.x === "number") {\nput();\nconsole.log(a.x.toFixed(1));\n}',
    ],
    [
      2,
      'const a: { x: number | string } = { x: "t" };\nconst put = () => {\na.x = 5;\n};\nif (typeof a.x === "string") {\nput();\nconsole.log(a.x.length, a.x + "!");\n}',
    ],
    [
      3,
      'let v: number | string = 1;\nconst put = () => {\nv = "t";\n};\nif (typeof v === "number") {\nput();\nconsole.log(v + 1);\n}',
    ],
    [2, 'let v: number | string = 1;\nconst put = () => {\nv = "t";\n};\nput();\nconsole.log(v + 1, typeof v);'],
    [
      3,
      "const a: { x: number | null } = { x: 1 };\nconst put = () => {\na.x = null;\n};\nif (a.x !== null) {\nput();\nconsole.log(a.x + 1);\n}",
    ],
    [
      2,
      "const a: { x: number | null } = { x: 1 };\nconst put = () => {\na.x = null;\n};\nif (a.x !== null) {\nput();\nconsole.log(a.x.toFixed(1));\n}",
    ],
    [
      2,
      "const a: { x?: number } = { x: 1 };\nconst drop = () => {\ndelete a.x;\n};\nif (a.x !== undefined) {\ndrop();\nconsole.log(a.x + 1, Object.keys(a).length);\n}",
    ],
    [
      2,
      "const a: { inner: { n: number } | null } = { inner: { n: 1 } };\nconst put = () => {\na.inner = null;\n};\nif (a.inner) {\nput();\nconsole.log(a.inner.n);\n}",
    ],
    [
      3,
      'type Shape = { kind: "a"; n: number } | { kind: "b"; s: string };\nconst a: { shape: Shape } = { shape: { kind: "a", n: 1 } };\nconst put = () => {\na.shape = { kind: "b", s: "t" };\n};\nif (a.shape.kind === "a") {\nput();\nconsole.log(a.shape.n, a.shape.kind);\n}',
    ],
    [
      2,
      'class One {\nn = 1;\n}\nclass Other {\ns = "t";\n}\nconst a: { o: One | Other } = { o: new One() };\nconst put = () => {\na.o = new Other();\n};\nif (a.o instanceof One) {\nput();\nconsole.log(a.o.n, a.o.n + 1);\n}',
    ],
    [
      2,
      'const a: { o: { n: number } | { s: string } } = { o: { n: 1 } };\nconst put = () => {\na.o = { s: "t" };\n};\nif ("n" in a.o) {\nput();\nconsole.log(a.o.n);\n}',
    ],
    [
      2,
      'const list: (number | string)[] = [1, 2];\nconst put = () => {\nlist[0] = "t";\n};\nif (typeof list[0] === "number") {\nput();\nconsole.log(list[0] + 1);\n}',
    ],
    [
      2,
      "const a: { list: number[] | null } = { list: [1, 2] };\nconst put = () => {\na.list = null;\n};\nif (a.list) {\nput();\nconsole.log(a.list.length);\n}",
    ],
    [
      1,
      "const a: { f: (() => number) | null } = { f: () => 1 };\nconst put = () => {\na.f = null;\n};\nif (a.f) {\nput();\nconsole.log(a.f());\n}",
    ],
  ];

  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", (error as Error).constructor.name);\n}`;
  if (random.chance(0.3)) {
    const text = random.weighted(narrowed);
    const place = random.pick(["top", "once", "once", "thrice"] as const);
    if (place === "top") return `${guarded(text)}\nexport {};\n`;
    return `function run() {\n${text}\n}\n${guarded(place === "once" ? "run();" : "run();\nrun();\nrun();")}\nexport {};\n`;
  }

  const pair = random.weighted(pairs)();
  const R = pair.read;
  const store = random.pick(pair.stores);
  const statement = `${store};`;
  const isANumber = R === "a.x" || R === "a.length" || R === "a.size" || R === "a[0]" || R === "a[1]";
  const first =
    R === "a.x" || R === "a[0]" || R === "a.get(1)" || R === "a.size"
      ? "1"
      : R === "a.has(1)"
        ? "true"
        : R === "a[1]"
          ? "2"
          : R === "a.at(-1)"
            ? "3"
            : pair.first;
  const scene = random.weighted([
    [5, `const before = ${R};\n${statement}\nconsole.log(before, ${R});`],
    [3, `console.log(${R}, (${store}, 0), ${R});`],
    [4, `if (${R} === ${first}) {\n${statement}\nconsole.log(${R} === ${first} ? "same" : "other", ${R});\n}`],
    [2, `let turns = 0;\nwhile (${R} === ${first} && turns++ < 3) {\n${statement}\n}\nconsole.log(turns, ${R});`],
    [2, `for (let turn = 0; turn < 2; turn++) {\nconsole.log(${R});\n${statement}\n}`],
    [2, `const one = ${R},\nother = (${store}, ${R});\nconsole.log(one, other, one === other);`],
    [2, `console.log(typeof ${R});\n${statement}\nconsole.log(typeof ${R});`],
    [isANumber ? 3 : 0, `const sum = ${R} + (${store}, 0) + ${R};\nconsole.log(sum);`],
    [isANumber ? 2 : 0, `console.log(${R} + 1);\n${statement}\nconsole.log(${R} + 1);`],
    [isANumber ? 1 : 0, `console.log(${R} * 2, (${store}, ${R} * 2));`],
  ]);
  const body = [pair.setup, scene].filter(Boolean).join("\n");
  const head = [pair.types, pair.outside].filter(Boolean).join("\n");
  const place =
    pair.parameters !== undefined
      ? random.pick(["once", "once", "thrice"] as const)
      : random.pick(["top", "once", "once", "thrice"] as const);
  const text =
    place === "top"
      ? [head, guarded(body)].filter(Boolean).join("\n")
      : [
          head,
          `function scene(${pair.parameters ?? ""}) {\n${body}\n}`,
          guarded(
            Array(place === "once" ? 1 : 3)
              .fill(`scene(${pair.given ?? ""});`)
              .join("\n"),
          ),
        ]
          .filter(Boolean)
          .join("\n");
  return `${text}\nexport {};\n`;
}
