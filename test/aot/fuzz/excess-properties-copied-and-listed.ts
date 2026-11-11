// TypeScript programs that type-check. A function has a parameter of a declared object type and receives a value that
// satisfies the type but is laid out differently: more members, another order, accessors, inherited or hidden members.
// The function copies or enumerates it.
import type { Random } from "./random";

export function generate(random: Random): string {
  const type = random.weighted([
    [5, "class"],
    [4, "interface"],
    [3, "optional"],
    [1, "length"],
  ] as const);
  const T = { class: "P", interface: "I", optional: "O", length: "{ length: number }" }[type];
  const declared = {
    class: 'class P {\nx = 1;\ny = "t";\n}',
    interface: "interface I {\nx: number;\ny: string;\n}",
    optional: "type O = { x: number; y?: string };",
    length: "",
  }[type];
  const exact = {
    class: "new P()",
    interface: '{ x: 1, y: "t" }',
    optional: '{ x: 1, y: "t" }',
    length: "{ length: 2 }",
  }[type];

  const values: [number, string, string][] =
    type === "length"
      ? [
          [3, "", "[7, 8]"],
          [3, "", '"ab"'],
          [2, "", "function (a: number, b: number) {}"],
          [2, "", "new Uint8Array(2)"],
          [1, "", 'new String("ab")'],
          [1, "const wide = { length: 2, more: 1 };", "wide"],
        ]
      : [
          ...(type === "class"
            ? ([
                [5, "class Q extends P {\nz = 3;\n}", "new Q()"],
                [2, 'class Q extends P {\ny = "of Q";\nz = 3;\n}', "new Q()"],
                [2, "class Q extends P {\nget w() {\nreturn 4;\n}\n}", "new Q()"],
              ] as [number, string, string][])
            : []),
          [5, 'const wide = { x: 1, y: "t", z: 3 };', "wide"],
          [3, 'const wide = { w: 0, x: 1, y: "t" };', "wide"],
          [4, 'const turned = { y: "t", x: 1 };', "turned"],
          [3, `const grown = Object.assign(${exact}, { extra: 1 });`, "grown"],
          [2, `const grown = Object.assign(${exact}, { 0: "i" });`, "grown"],
          [2, `const grown = Object.assign(${exact}, { [Symbol("s")]: 1 });`, "grown"],
          [4, 'const got = {\nget x() {\nreturn 1;\n},\ny: "t",\n};', "got"],
          [4, 'class G {\nget x() {\nreturn 1;\n}\ny = "t";\n}', "new G()"],
          [1, 'class G {\nx = 1;\nget y() {\nreturn "t";\n}\n}', "new G()"],
          [3, `const hidden = ${exact};\nObject.defineProperty(hidden, "x", { enumerable: false });`, "hidden"],
          [3, `const behind = new Proxy(${exact}, {});`, "behind"],
          [2, `const behind = new Proxy(${exact}, {\nownKeys() {\nreturn ["y", "x"];\n},\n});`, "behind"],
          [3, `const below: ${T} = Object.create(${exact});`, "below"],
          [1, `const below: ${T} = Object.assign(Object.create(${exact}), { x: 5 });`, "below"],
          [2, `const fixed = Object.freeze(${exact});`, "fixed"],
          [2, `const moved = ${exact};\nObject.setPrototypeOf(moved, { above: 1 });`, "moved"],
          [1, `const bare: ${T} = Object.assign(Object.create(null), { x: 1, y: "t" });`, "bare"],
          ...(type === "optional"
            ? ([
                [4, "", "{ x: 1 }"],
                [3, "", "{ x: 1, y: undefined }"],
                [3, 'const dropped: O = { x: 1, y: "t" };\ndelete dropped.y;', "dropped"],
                [2, 'const dropped: O = { x: 1, y: "t" };\ndelete dropped.y;\ndropped.y = "again";', "dropped"],
              ] as [number, string, string][])
            : []),
        ];
  const [, setup, odd] = random.weighted(values.map(each => [each[0], each] as const));

  const first = type === "length" ? "length" : "x";
  const works: [number, string][] = [
    [5, "console.log(JSON.stringify({ ...o }));"],
    [3, "console.log(Object.keys({ ...o }).join());"],
    [2, `console.log(JSON.stringify({ ...o, ${first}: 2 }));`],
    [2, "console.log(JSON.stringify({ ahead: 0, ...o }));"],
    [3, "console.log(JSON.stringify(Object.assign({}, o)));"],
    [4, `{\nconst { ${first}, ...others } = o;\nconsole.log(${first}, JSON.stringify(others));\n}`],
    [4, "console.log(Object.keys(o).join());"],
    [2, "console.log(Object.values(o).map(String).join());"],
    [3, "console.log(JSON.stringify(Object.entries(o)));"],
    [3, '{\nlet all = "";\nfor (const key in o) all += key + " ";\nconsole.log(all);\n}'],
    [4, "console.log(JSON.stringify(o));"],
    [1, "console.log(JSON.stringify(structuredClone(o)));"],
    [1, "console.log(JSON.stringify([o, { ...o }]));"],
    [1, "console.log(Reflect.ownKeys(o).map(String).join());"],
    [1, "console.log(Object.keys(o).length, Object.getOwnPropertyNames(o).length);"],
    ...(type === "length" ? [] : ([[2, "console.log(o.x, o.y, JSON.stringify({ ...o }));"]] as [number, string][])),
  ];
  const work = Array.from({ length: random.pick([1, 1, 2]) }, () => random.weighted(works)).join("\n");
  const calls = random.pick([[odd], [odd], [odd], [exact, odd], [odd, exact], [exact, exact, odd], [odd, odd]]);
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", (error as Error).constructor.name);\n}`;
  const show = `function show(o: ${T}) {\n${work}\n}`;
  const scene = [setup, calls.map(value => `show(${value});`).join("\n")].filter(Boolean).join("\n");
  const where = random.pick(["top", "top", "once"] as const);
  const head = [declared, show].filter(Boolean).join("\n");
  if (where === "top") return `${head}\n${guarded(scene)}\nexport {};\n`;
  return `${head}\nfunction run() {\n${scene}\n}\n${guarded("run();")}\nexport {};\n`;
}
