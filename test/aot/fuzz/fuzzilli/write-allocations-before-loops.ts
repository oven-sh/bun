// Writes programs in which an object, an array, a closure, an instance or a map is allocated before loops and used after them, in them or on one exit of them.
// The loops store into it, read it, compare its identity across iterations, capture it in closures and leave by break, continue with a label, return or an exception that is caught outside or inside.
// Each program prints what the object holds at every exit.
// For write-random-allocation-sweep.ts and for a scene of write-ordinary-scenes.ts.

const places = ["function", "method", "generator", "async-function", "called-in-loop", "arrow"] as const;
const ownNames = /\b(?:show|Holder|run|Runner)\b/g;

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeAllocationsBeforeLoops(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const anyType = isTyped ? ": any" : "";
  const place = random.pick(places);
  const objectCount = 1 + random.below(3);
  const depth = 1 + random.below(2);
  const hasTry = random.chance(0.35);
  type Kind = "object" | "array" | "closure" | "instance" | "map";
  const kinds = Array.from({ length: objectCount }, () =>
    random.pick<Kind>(["object", "object", "array", "array", "closure", "instance", "map"]),
  );
  const name = (index: number) => "object" + index;
  const create = (kind: Kind) =>
    ({
      object: `{ count: ${random.pick(["0", "1", "limit"])}, last: ${random.pick(["-1", "undefined", "limit"])}${random.chance(0.4) ? ", list: []" : ""} }`,
      array: random.pick(["[]", "[limit]", "[1, 2]", "[limit, limit + 1]"]),
      closure: `() => ${random.pick(["sum", "limit", "seen.length"])}`,
      instance: "new Holder(limit)",
      map: "new Map()",
    })[kind];
  /** A statement that changes an object or prints it. */
  const use = (index: number, turn: string): string => {
    if (index < 0) return random.pick([`sum += ${turn};`, `seen.push(String(${turn}));`]);
    const it = name(index);
    switch (kinds[index]) {
      case "array":
        return random.pick([
          `${it}.push(${turn});`,
          `${it}[0] = ${turn};`,
          `sum += ${it}.length;`,
          `seen.push(String(${it}[${turn}]));`,
          `if (${it}.length > 3) ${it}.length = 1;`,
        ]);
      case "closure":
        return random.pick([`sum += ${it}();`, `seen.push(String(${it}()));`, `kept = ${it};`]);
      case "map":
        return random.pick([
          `${it}.set(${turn}, sum);`,
          `sum += ${it}.size;`,
          `seen.push(String(${it}.get(${turn})));`,
        ]);
      default:
        return random.pick([
          `${it}.count++;`,
          `${it}.last = ${turn};`,
          `sum += ${it}.count;`,
          `seen.push(String(${it}.last));`,
          `${it}.extra = sum;`,
          `kept = ${it};`,
        ]);
    }
  };
  const printObject = (index: number): string => {
    if (index < 0) return random.chance(0.5) && idle >= 0 ? printObject(idle) : 'show("sum", sum);';
    const it = name(index);
    switch (kinds[index]) {
      case "closure":
        return `show("${it}", ${it}());`;
      case "map":
        return `show("${it}", JSON.stringify([...${it}]));`;
      default:
        return `show("${it}", JSON.stringify(${it}));`;
    }
  };
  // In most programs no loop uses one of the objects: it is used after the loops alone.
  const idle = random.chance(0.7) ? random.below(objectCount) : -1;
  const used = kinds.map((_, index) => index).filter(index => index !== idle);
  const anyObject = () => (used.length ? random.pick(used) : -1);
  const statement = (turn: string): string => {
    switch (hasTry ? random.below(9) : random.pick([0, 1, 3, 4, 5, 6, 7, 8])) {
      case 0:
        return "sum += " + turn + ";";
      case 1:
        return `if (${turn} === ${random.below(4)}) ${use(anyObject(), turn)}`;
      case 2:
        return `try { if (${turn} === ${random.below(4)}) throw ${random.pick([used.length ? name(anyObject()) : "sum", 'new Error("thrown")'])}; } catch (error) { seen.push(typeof error); ${use(anyObject(), turn)} }`;
      case 3:
        return `same = same && (kept === undefined || kept === ${used.length ? name(anyObject()) : "kept"});`;
      case 4:
        return `closures.push(() => ${random.pick([used.length ? name(anyObject()) : turn, turn, "sum"])});`;
      case 5:
        return `limit += ${random.pick(["0", "1"])};`;
      default:
        return use(anyObject(), turn);
    }
  };
  const leave = (turn: string, label: string): string =>
    random.pick([
      `if (${turn} === ${random.below(5)}) break;`,
      `if (sum > ${random.below(8)}) { ${printObject(anyObject())} return sum; }`,
      `if (${turn} === ${random.below(5)}) { ${printObject(anyObject())} break ${label}; }`,
      `if (${turn} === ${random.below(5)}) continue ${label};`,
      hasTry ? `if (${turn} === ${random.below(5)}) throw new RangeError("out");` : "",
      "",
      "",
    ]);
  const suspend = () =>
    place === "generator" && random.chance(0.3)
      ? "yield sum;"
      : place === "async-function" && random.chance(0.3)
        ? "await null;"
        : "";
  // One of the objects may be replaced in the outer loop.
  const replaced = random.chance(0.3) ? random.below(objectCount) : -1;
  const allocations = kinds.map(
    (kind, index) => `${index === replaced ? "let" : "const"} ${name(index)}${anyType} = ${create(kind)};`,
  );
  const inner = (turn: string, label: string) =>
    [...Array.from({ length: 1 + random.below(3) }, () => statement(turn)), leave(turn, label), suspend()].filter(
      Boolean,
    );
  const bound = () => random.pick(["limit", "3", "5", "1", "0", "seen.length + 2"]);
  const lines: string[] = [];
  lines.push(...allocations);
  lines.push(`outer: for (let i = 0; i < ${bound()} && i < 8; i++) {`);
  if (replaced >= 0)
    lines.push(
      `  ${random.pick(["", `if (i === ${random.below(3)}) `])}${name(replaced)} = ${create(kinds[replaced])};`,
    );
  if (depth === 2) {
    lines.push(
      ...inner("i", "outer")
        .slice(0, 2)
        .map(line => "  " + line),
    );
    lines.push(
      `  inner: for (let j = 0; j < ${bound()} && j < 8; j++) {`,
      ...inner("j", random.pick(["outer", "inner"])).map(line => "    " + line),
      "  }",
    );
    lines.push(...inner("i", "outer").map(line => "  " + line));
  } else lines.push(...inner("i", "outer").map(line => "  " + line));
  lines.push("}");
  if (random.chance(0.3)) lines.push(`while (sum < ${random.below(12)}) { sum += 2; ${use(anyObject(), "sum")} }`);
  const printed = idle >= 0 ? idle : anyObject();
  if (idle >= 0 && random.chance(0.3)) lines.push(use(idle, "sum"));
  lines.push(
    random.chance(0.7)
      ? `if (${random.pick(["sum > 4", "limit > 3", "seen.length > 1", "same"])}) { ${printObject(printed)} } else { show("other", sum); }`
      : printObject(printed),
  );
  if (random.chance(0.4)) lines.push(`show("closures", closures.map(each => typeof each()).join());`);
  const state = [
    `let sum${anyType} = 0;`,
    `let same${anyType} = true;`,
    `let kept${anyType};`,
    `const seen${isTyped ? ": any[]" : ""} = [];`,
    `const closures${isTyped ? ": any[]" : ""} = [];`,
  ];
  const guarded = [
    "try {",
    ...lines.map(line => "  " + line),
    "} catch (error) {",
    `  show("caught", (error${isTyped ? " as any" : ""}).name);`,
    "}",
  ];
  const body = [
    ...state,
    ...(hasTry ? guarded : lines),
    'show("end", [sum, same, seen.join("|")].join());',
    "return sum;",
  ];
  const indent = (text: string[]) => text.map(line => "  " + line);
  const parameter = `limit${anyType}`;
  const program = [
    `function show(label${anyType}, value${anyType}) {\n  console.log(label, String(value));\n}`,
    `class Holder {\n${isTyped ? "  count: any;\n  last: any;\n  extra: any;\n" : ""}  constructor(limit${anyType}) {\n    this.count = limit;\n    this.last = 0;\n  }\n}`,
  ];
  const argument = random.pick(["4", "2", "process.argv.length + 1", 'JSON.parse("3")']);
  if (place === "method")
    program.push(
      "class Runner {",
      `  run(${parameter})${anyType} {`,
      ...indent(indent(body)),
      "  }",
      "}",
      `show("result", new Runner().run(${argument}));`,
    );
  else if (place === "generator")
    program.push(
      `function* run(${parameter})${isTyped ? ": Generator<any>" : ""} {`,
      ...indent(body),
      "}",
      `show("result", [...run(${argument})].join());`,
    );
  else if (place === "async-function")
    program.push(
      `async function run(${parameter})${isTyped ? ": Promise<any>" : ""} {`,
      ...indent(body),
      "}",
      `show("result", await run(${argument}));`,
    );
  else if (place === "arrow")
    program.push(
      `const run = (${parameter})${anyType} => {`,
      ...indent(body),
      "};",
      `show("result", run(${argument}));`,
    );
  else
    program.push(
      `function run(${parameter})${anyType} {`,
      ...indent(body),
      "}",
      place === "function"
        ? `show("result", run(${argument}));`
        : `for (let call = 0; call < 4; call++) show("result", run(call));`,
    );
  return {
    name: `${objectCount}-objects--depth-${depth}--${place}`,
    lines: program
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "(").replace(ownNames, name => name + suffix)),
  };
}
export const writeSceneOfAllocationsBeforeLoops = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeAllocationsBeforeLoops(random, isTypeScript, "printValue", "_" + n).lines;
