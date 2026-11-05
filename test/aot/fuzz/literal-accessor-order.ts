// One object literal with a getter and a setter among two or three other members. Members take effect in source order:
// a later half joins an accessor of the same name, a value replaces an accessor, an accessor replaces a value.
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const holds = random.pick(["nothing", "parameter", "parameter", "parameter", "this", "super"] as const);
  const G = {
    nothing: '"got"',
    parameter: '"got " + n',
    this: '"got " + this.b',
    super: '"got " + super.toString.name',
  }[holds];
  const S = {
    nothing: 'log += "set " + given + " "',
    parameter: 'log += "set " + given + " by " + n + " "',
    this: "this.b = given",
    super: 'log += "set " + given + " "',
  }[holds];
  const name = random.pick(["a", "a", "a", '"a"', "1", '["a"]', '["a" + ""]', "[key]"]);
  const plain = name === "1" ? "1" : "a";
  const dot = plain === "1" ? "[1]" : ".a";
  const text = plain === "1" ? '"1"' : '"a"';
  const getter = `get ${name}() {\nreturn ${G};\n}`;
  const setter = `set ${name}(given) {\n${S};\n}`;
  const between: [number, string][] = [
    [4, 'b: "b"'],
    [2, "c: 3"],
    [2, `m() {\nreturn "m";\n}`],
    [3, `${plain}: "a value"`],
    [2, `[${text}]: "under a computed key"`],
    [1, `[key]: "under a variable"`],
    [2, `...{ ${plain}: "out of a spread" }`],
    [1, `...{\nget ${plain}() {\nreturn "a getter out of a spread";\n},\n}`],
    [2, "...{ d: 4 }"],
    [1, "...null"],
    [1, `__proto__: { ${plain}: "above", above: 1 }`],
    [1, `${plain}() {\nreturn "a method";\n}`],
    [1, `get b() {\nreturn "got b";\n}`],
    [1, "0: 0"],
  ];
  const halves = random.weighted([
    [5, [getter, setter]],
    [5, [setter, getter]],
    [2, [getter]],
    [2, [setter]],
  ]);
  const others = Array.from({ length: random.pick([0, 1, 1, 2, 2, 3]) }, () => random.weighted(between));
  // The getter and setter keep their relative order; the other members go anywhere.
  const members: string[] = [...halves];
  for (const other of others) members.splice(random.below(members.length + 1), 0, other);
  if (members.filter(member => member.startsWith("__proto__")).length > 1)
    members.splice(
      members.findIndex(member => member.startsWith("__proto__")),
      1,
    );
  const literal = `{\n${members.join(",\n")},\n}`;
  const usesKey = literal.includes("[key]");

  const asks = (o: string): string[] => [
    `console.log(${o}${dot});`,
    `console.log(${o}${dot});`,
    `${o}${dot} = 5;\nconsole.log(${o}${dot}, log);`,
    `${o}${dot} = 5;\nconsole.log(${o}${dot}, log);`,
    `{\nconst found = Object.getOwnPropertyDescriptor(${o}, ${text});\nconsole.log(typeof found?.get, typeof found?.set, typeof found?.value === "function" ? "function" : String(found?.value), found?.enumerable, found?.configurable, found?.writable);\n}`,
    `{\nconst found = Object.getOwnPropertyDescriptor(${o}, ${text});\nconsole.log(typeof found?.get, typeof found?.set, typeof found?.value === "function" ? "function" : String(found?.value), found?.enumerable, found?.configurable, found?.writable);\n}`,
    `console.log(Object.keys(${o}).join());`,
    `console.log(JSON.stringify(${o}));`,
    `console.log(JSON.stringify({ ...${o} }));`,
    `console.log(Reflect.ownKeys(${o}).join(), Object.getPrototypeOf(${o}) === Object.prototype);`,
    `console.log(Object.getOwnPropertyDescriptor(${o}, ${text})?.get?.name, Object.getOwnPropertyDescriptor(${o}, ${text})?.set?.name);`,
    `console.log(${o}.b, ${o}.c, ${o}.d);`,
    `console.log(Reflect.set(${o}, ${text}, 7), ${o}${dot}, log);`,
    `console.log(delete ${o}${dot}, ${o}${dot}, Object.keys(${o}).join());`,
    `Object.defineProperty(${o}, ${text}, { enumerable: false });\nconsole.log(Object.keys(${o}).join(), ${o}${dot});`,
  ];
  const pick = () => random.below(asks("o").length);
  const chosen = Array.from({ length: random.pick([1, 2, 2, 3]) }, pick);
  const told = (o: string) => chosen.map(index => asks(o)[index]).join("\n");

  const made = random.pick(["once", "once", "twice", "twice", "loop"] as const);
  const needsN = holds === "parameter";
  const head = ['let log = "";', usesKey ? `const key = ${random.pick([text, text, '"other"'])};` : ""]
    .filter(Boolean)
    .join("\n");
  const shares = `{\nconst one = Object.getOwnPropertyDescriptor(first, ${text});\nconst other = Object.getOwnPropertyDescriptor(second, ${text});\nconsole.log(one?.get === other?.get && one?.get !== undefined, one?.set === other?.set && one?.set !== undefined);\n}`;
  let scene: string;
  if (made === "once") scene = `${needsN ? "const n = 1;\n" : ""}const o = ${literal};\n${told("o")}`;
  else if (made === "twice")
    scene = `function make(n) {\nreturn ${literal};\n}\nconst first = make(1);\nconst second = make(2);\n${random.chance(0.5) ? `${told("first")}\n${told("second")}` : `${told("second")}\n${told("first")}`}${random.chance(0.4) ? "\n" + shares : ""}`;
  else
    scene = `const all = [];\nfor (let n = 0; n < 3; n++) all.push(${literal});\nfor (const each of all) {\n${told("each")}\n}`;
  const guarded = (body: string) =>
    `try {\n${body}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const where = random.pick(["top", "top", "once", "thrice"] as const);
  if (where === "top") return { file, text: `${head}\n${guarded(scene)}\n` };
  return {
    file,
    text: `${head}\nfunction run() {\n${scene}\n}\n${guarded(where === "once" ? "run();" : "run();\nrun();\nrun();")}\n`,
  };
}
