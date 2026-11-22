// `const o = k === 0 ? new A(k) : new B(k); o.size`: two or three constructor functions or classes whose objects hold the same fields
// and whose prototypes differ. One prototype gets a member: a method, a getter, a setter or a value. Another gets nothing, the same member
// under a test that never holds, the member and then a delete, or another function under the same name. A compiler that tells the objects
// apart by their fields, or that believes of one constructor what it has seen of another, reads the wrong member. What varies: the kind of
// member and how it is laid, whether one prototype stands below another or copies its members, whether an object of a constructor exists
// before the loop, whether a prototype changes between two uses, whether the choice goes by a list that the build cannot read or by a
// test that it cannot decide, whether the objects are kept, and how the member is asked for.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

export function helpers(typed: boolean): string {
  return `const T = process.argv.length > 0, F = process.argv.length > 99;
function show(v${typed ? ": unknown" : ""})${typed ? ": string" : ""} {
  return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function" : String(v);
}
`;
}

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const loose = (value: string) => (typed ? `(${value} as any)` : value);
  const areClasses = typed || random.chance(0.3);
  const letters = random.chance(0.75) ? ["A", "B"] : ["A", "B", "C"];
  const made = letters.map(letter => `${name}${letter}`);
  const [first, second] = made;
  const hasTwoFields = random.chance(0.3);
  const member = random.pick(["size", "twice", "y", "m"]);
  const kind = random.weighted([
    [3, "method"],
    [4, "getter"],
    [2, "setter"],
    [2, "value"],
  ] as const);

  const lines: string[] = [];
  const own = `${name}own`;
  const other = `${name}other`;
  const log = `${name}log`;
  const self = typed ? "this: any" : "";
  if (kind === "setter") {
    lines.push(`const ${log}${as("unknown[]")} = [];`);
    lines.push(`function ${own}(${typed ? "this: any, v: unknown" : "v"}) { ${log}.push(v); }`);
    lines.push(`function ${other}(${typed ? "this: any, v: unknown" : "v"}) { ${log}.push("other"); }`);
  } else {
    lines.push(`function ${own}(${self}) { return this.x ${random.pick(["+ 100", "* 2", "- 1"])}; }`);
    lines.push(`function ${other}(${self}) { return this.x ${random.pick(["+ 7", "* 3"])}; }`);
  }
  for (const constructor of made) {
    const fields = hasTwoFields ? "this.x = x; this.w = 0;" : "this.x = x;";
    if (areClasses)
      lines.push(
        `class ${constructor} { ${typed ? `x: number; ${hasTwoFields ? "w: number; " : ""}` : ""}constructor(x${as("number")}) { ${fields} } }`,
      );
    else lines.push(`function ${constructor}(x) { ${fields} }`);
  }

  const laid = (constructor: string, what: string) => {
    const prototype = `${constructor}.prototype`;
    switch (kind) {
      case "method":
        return random.chance(0.75)
          ? `${loose(prototype)}.${member} = ${what};`
          : `Object.defineProperty(${prototype}, "${member}", { value: ${what}, configurable: true, writable: true });`;
      case "getter":
        return `Object.defineProperty(${prototype}, "${member}", { get: ${what}, configurable: true });`;
      case "setter":
        return `Object.defineProperty(${prototype}, "${member}", { set: ${what}, configurable: true });`;
      default:
        return `${loose(prototype)}.${member} = ${what === own ? "7" : "9"};`;
    }
  };
  const removed = (constructor: string) => `delete ${loose(`${constructor}.prototype`)}.${member};`;
  const onTheOthers = (constructor: string) =>
    random.weighted([
      [3, [] as string[]],
      [4, [`if (F) ${laid(constructor, own)}`]],
      [2, [laid(constructor, own), removed(constructor)]],
      [2, [laid(constructor, other)]],
      [1, [`if (T) ${laid(constructor, own)}`]],
    ] as const);

  const relation = random.weighted([
    [6, "none"],
    [2, "below"],
    [1, "copied"],
  ] as const);
  const setUp = [laid(second, own), ...onTheOthers(first), ...made.slice(2).flatMap(onTheOthers)];
  lines.push(...(random.chance(0.3) ? random.shuffled(setUp) : setUp));
  if (relation === "below") lines.push(`Object.setPrototypeOf(${first}.prototype, ${second}.prototype);`);
  if (relation === "copied")
    lines.push(
      `for (const key in ${second}.prototype) ${loose(`${first}.prototype`)}[key] = ${loose(`${second}.prototype`)}[key];`,
    );

  const asked = (o: string) => {
    const read = `${loose(o)}.${member}`;
    switch (kind) {
      case "method":
        return random.chance(0.8)
          ? `(() => { try { return ${read}(); } catch (error) { return error instanceof TypeError ? "TypeError" : "other"; } })()`
          : `typeof ${read}`;
      case "setter":
        return `(${read} = 5, ${log}.length + ":" + show(${read}))`;
      default:
        return random.weighted([
          [6, read],
          [1, `("${member}" in ${o})`],
          [1, `typeof ${read}`],
        ] as const);
    }
  };
  const fresh = (constructor: string, value: string) => `new ${constructor}(${value})`;

  const early = `${name}early`;
  const existsEarly = random.chance(0.75);
  if (existsEarly) lines.push(`const ${early} = show(${asked(`(${fresh(second, "1")})`)});`);
  if (random.chance(0.15)) lines.push(`const ${name}kept = [${fresh(second, "2")}];`);

  const kinds = Array.from({ length: random.between(3, 6) }, () => random.below(letters.length));
  const list = random.chance(0.7) ? `JSON.parse(process.argv[9] ?? "[${kinds.join(",")}]")` : `[${kinds.join(", ")}]`;
  const value = random.pick(["k", "8", "k + 1"]);
  const choice =
    letters.length === 2
      ? random.chance(0.8)
        ? `k === 0 ? ${fresh(first, value)} : ${fresh(second, value)}`
        : `${random.pick(["T", "F"])} ? ${fresh(first, value)} : ${fresh(second, value)}`
      : `k === 0 ? ${fresh(first, value)} : k === 1 ? ${fresh(second, value)} : ${fresh(made[2], value)}`;
  const keeps = random.chance(0.6);
  const change = random.chance(0.3)
    ? random.pick([removed(second), removed(first), laid(first, own), laid(second, other)])
    : "";
  const loop = [
    `const all${as("unknown[]")} = [], seen${as("unknown[]")} = [];`,
    `for (const k of ${list}${typed ? " as number[]" : ""}) {`,
    `  const o = ${choice};`,
    ...(keeps ? ["  all.push(o);"] : []),
    `  seen.push(${asked("o")});`,
    ...(change && random.chance(0.5) ? [`  if (k === ${random.below(letters.length)}) { ${change} }`] : []),
    "}",
  ];
  const result = `${keeps ? "JSON.stringify(all) + " : ""}seen.map(show).join()`;
  const calls: string[] = existsEarly ? [early] : [];
  if (random.chance(0.5)) {
    lines.push(`function ${name}() {`, ...loop.map(line => "  " + line), `  return ${result};`, "}");
    calls.push(`${name}()`);
    if (change && random.chance(0.6)) calls.push(`(() => { ${change} return ${name}(); })()`);
  } else {
    const answer = `${name}answer`;
    lines.push(`let ${answer} = "";`, "{", ...loop.map(line => "  " + line), `  ${answer} = ${result};`, "}");
    calls.push(answer);
  }
  return { name, text: lines.join("\n") + "\n", calls };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(6, 12) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
