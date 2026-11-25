// `total += first[at]; second[i] = value; total += first[at];`: something is read, a store goes through a second name, and the same thing is read
// again. In some calls the two names mean one object. What varies: what the object is (a list, a typed array, an object with fields, a Map) and
// how it was made, by which road the second name comes (a parameter, a captured variable, a field, a variable of the module), what is read,
// how what is read is used (added up, multiplied, compared with a number), how the store is made, what is stored (whole numbers, fractions, NaN,
// undefined, null, texts, objects), whether all that stands in a loop, whether the kind is declared, and which objects the other calls of the
// same function get: a list of another kind, a list of texts that look like numbers.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

export function helpers(typed: boolean): string {
  const any = typed ? ": any" : "";
  return `var unlikely = process.argv.length > 99;
function turnsOf(text${typed ? ": string" : ""})${typed ? ": number" : ""} {
  return JSON.parse(text);
}
function opened(list${any})${any} {
  if (unlikely) list[0] = "s";
  return list;
}
function loosened(object${any})${any} {
  if (unlikely) object.x = "s";
  return object;
}
function told(ask${typed ? ": () => unknown" : ""})${typed ? ": string" : ""} {
  try {
    return String(ask());
  } catch (error) {
    return (error${typed ? " as Error" : ""}).name;
  }
}
`;
}

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const any = typed ? ": any" : "";
  const loose = (text: string) => (typed ? `(${text} as any)` : text);
  const what = random.weighted([
    [7, "list"],
    [3, "bytes"],
    [4, "object"],
    [2, "table"],
  ] as const);
  const road = random.weighted([
    [5, "parameter"],
    [2, "captured"],
    [2, "field"],
    [2, "module"],
  ] as const);
  const second = road === "field" ? "holder.second" : road === "module" ? `${name}S` : "second";

  let type = "any";
  let makers: string[];
  let read: string;
  let store: string;
  let values: string[];
  let plain: string;
  let texts: string[] = [];
  if (what === "list") {
    type = "number[]";
    makers = [
      "[1, 2, 3, 4, 5, 6]",
      "[1.5, 2.5, 3.5, 4.5, 5.5, 6.5]",
      "[1.5, 2.5, 3.5, 4.5, 5.5, 6.5]",
      "opened([1, 2, 3, 4, 5, 6])",
      "opened([1.5, 2.5, 3.5, 4.5, 5.5, 6.5])",
      `[1.5, , 3.5, 4.5, 5.5, 6.5]${typed ? " as number[]" : ""}`,
      `new Array${typed ? "<number>" : ""}(6).fill(1.5)`,
      'JSON.parse("[1.5,2.5,3.5,4.5,5.5,6.5]")',
      `Array.from({ length: 6 }, (_, i) => i + 0.5)`,
      "[1.5, -1.5, 2.5, 3.5, 4.5, 6.5]",
    ];
    texts = [
      '"1,2,3,4,5,6".split(",")',
      'Object.values(JSON.parse(\'{"a":"1","b":"2","c":"3","d":"4","e":"5","f":"6"}\'))',
      '"1 2 3 4 5 6".match(/\\d/g)',
      '["1", "2", "3", "4", "5", "6"]',
    ].map(text => (typed ? `(${text} as any)` : text));
    read = random.pick(["first[at]", "first[at]", "first[at]", "first[at]", "first[at]", "first[at]", "first[i]", "first.length", "(first[at] ?? -1)", `first.at(-1)${typed ? "!" : ""}`, "first[at] * 2", "first[i] * 2", "(first[at] < 0 ? 1 : 2)", "Math.sqrt(first[at])", "(first[i] - 1)"]); // prettier-ignore
    store = random.weighted([
      [14, `${second}[i] = value;`],
      [3, `${second}[at] = value;`],
      [1, `${second}.push(value);`],
      [1, `${second}.length = at;`],
      [1, `delete ${second}[at];`],
      [1, `${second}.fill(value);`],
      [1, `${second}[at + 40] = value;`],
      [1, `${second}.pop();`],
      [1, `${second}.reverse();`],
      [1, `${second}.unshift(value);`],
    ] as const);
    values = ["NaN", "NaN", "NaN", "undefined", "undefined", "null", "null", 'turnsOf("0") / turnsOf("0")', '"s"', "{}", "2147483648", "-0", "Infinity"]; // prettier-ignore
    plain = random.pick(["0.25", "7", "0.25"]);
  } else if (what === "bytes") {
    makers = [
      "new Float64Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5])",
      "new Int32Array([1, 2, 3, 4, 5, 6])",
      "new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])",
      "new Float32Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5])",
      "new Int16Array(new ArrayBuffer(16, { maxByteLength: 32 }))",
    ].map(maker =>
      typed && maker.includes("maxByteLength")
        ? "new Int16Array(new (ArrayBuffer as any)(16, { maxByteLength: 32 }))"
        : maker,
    );
    read = random.pick(["first[at]", "first[at]", "first[i]", "first.length", "first.byteLength"]);
    store = random.weighted([
      [6, `${second}[i] = value;`],
      [3, `${second}[at] = value;`],
      [1, `${second}.fill(value);`],
      [1, `${second}.set([value], at);`],
      [1, `if (i === 1) ${loose(`${second}.buffer`)}.transfer();`],
      [1, `if (i === 1 && ${loose(`${second}.buffer`)}.resizable) ${loose(`${second}.buffer`)}.resize(4);`],
      [1, `new Uint8Array(${second}.buffer)[at] = value;`],
    ] as const);
    values = ["NaN", "1.5", "-1", "300", "4294967296", "undefined", "-0", "Infinity"];
    plain = "2";
  } else if (what === "object") {
    makers = [
      "{ x: 1, y: 2 }",
      "{ x: 1.5, y: 2 }",
      "{ y: 2, x: 1 }",
      `new ${name}P()`,
      "loosened({ x: 1, y: 2 })",
      "loosened({ x: 1.5, y: 2 })",
      "Object.create({ x: 1, y: 2 })",
      'JSON.parse(\'{"x":1.5,"y":2}\')',
    ];
    read = random.pick([
      "first.x",
      "first.x",
      "first.x",
      "first.y",
      '("x" in first ? 1 : 2)',
      "Object.keys(first).length",
    ]);
    store = random.weighted([
      [6, `${second}.x = value;`],
      [2, `delete ${loose(second)}.x;`],
      [2, `${loose(second)}["z" + i] = value;`],
      [2, `Object.defineProperty(${second}, "x", { get() { return 9; }, configurable: true });`],
      [1, `Object.setPrototypeOf(${second}, { x: 5 });`],
      [1, `Object.freeze(${second});`],
      [1, `Object.assign(${second}, { x: value });`],
    ] as const);
    values = ["NaN", "undefined", "null", '"s"', "{}", "1.5", "2147483648", "-0", "() => 1"];
    plain = random.pick(["3", "0.25"]);
  } else {
    makers = [
      "new Map([[1, 1.5], [2, 2.5], [5, 5.5]])",
      "new Map([[5, 1], [1, 2]])",
      `new Map${typed ? "<any, any>" : ""}([["a", 1], [5, 2]])`,
      `new Map${typed ? "<any, any>" : ""}()`,
    ];
    read = random.pick([
      "first.get(at)",
      "first.get(at)",
      "first.size",
      "(first.has(at) ? 1 : 2)",
      "(first.has(at) ? first.get(at) : -1)",
    ]);
    store = random.weighted([
      [5, `${second}.set(at, value);`],
      [2, `${second}.delete(at);`],
      [1, `${second}.clear();`],
      [2, `${second}.set(i + 10, value);`],
    ] as const);
    values = ["NaN", "undefined", "null", '"s"', "1.5"];
    plain = "3";
  }

  // In half of the typed scenes on typed arrays, tables and objects the kind is declared, and both calls get that kind.
  let declaredAs = "";
  if (typed && what !== "list" && random.chance(0.5)) {
    if (what === "table") declaredAs = "Map<any, any>";
    else if (what === "object") declaredAs = `${name}P`;
    else declaredAs = random.pick(["Float64Array", "Int32Array", "Uint8Array", "Float32Array"]);
    type = declaredAs;
    if (what === "object") makers = [`new ${name}P()`];
    if (what === "bytes") makers = makers.filter(maker => maker.startsWith(`new ${declaredAs}(`));
    if (what === "table") makers = makers.map(maker => maker.replace(/^new Map\(/, "new Map<any, any>("));
  }
  const of = typed ? `: ${type}` : "";
  // The object is looked at by what its own kind offers. A helper that takes anything and asks what it got would tell whoever reads the
  // program that the object may be anything.
  const seen =
    what === "object" ? 'Object.keys(first).join() + "/" + String(first.x)' : what === "table" ? '[...first].join(";")' : what === "list" ? `first.join() + "/" + ${second}.join()` : "first.join()"; // prettier-ignore
  const isLoop = random.chance(0.85);
  // Two reads round the store, or one read a turn and a store that goes by it: the read of the next turn stands behind this turn's store.
  const isChosen = what === "list" && random.chance(0.3);
  const step = isChosen
    ? random.pick([
        `if (first[i] < 0) ${second}[i] = value; else ${second}[i] = first[i] * 2;`,
        `${second}[i] = first[i] < 0 ? value : first[i] * 2;`,
        `${second}[i] = first[i] < 0 ? value : Math.sqrt(first[i]);`,
      ])
    : `total += ${read}; ${store} total += ${read};`;
  // A list is declared as a list of numbers, and so are what is stored and the sum: what is no number is handed in under a cast.
  const isDeclared = typed && what === "list";
  const body = `  let total${isDeclared ? "" : any} = 0;
  ${isLoop ? `for (let i = 0; i < count; i++) { ${step} }` : `let i = 0; ${step}`}
  return String(total) + "/" + ${seen};`;
  const rest = `count${typed ? ": number" : ""}, at${typed ? ": number" : ""}, value${isDeclared ? ": number" : any}`;
  const made = what === "object" ? `class ${name}P { x${any} = 1; y = 2; }\n` : "";
  const text =
    made +
    (road === "parameter"
      ? `function ${name}(first${of}, second${of}, ${rest}) {\n${body}\n}\n`
      : road === "field"
        ? `function ${name}(first${of}, holder${typed ? `: { second: ${type} }` : ""}, ${rest}) {\n${body}\n}\n`
        : road === "captured"
          ? `function ${name}(first${of}, second${of}, ${rest}) {\n  const walk = (first${of}) => {\n${body.replace(/^/gm, "  ")}\n  };\n  return walk(first);\n}\n`
          : `let ${name}S${of}${typed ? " = undefined as any" : ""};\nfunction ${name}(first${of}, given${of}, ${rest}) {\n  ${name}S = given;\n${body}\n}\n`);

  const handed = (expression: string) => (road === "field" ? `{ second: ${expression} }` : expression);
  // The number of turns is written out in all calls of a function, or known to nobody in all of them.
  const turns = random.pick(["5", "5", "5", "4", "3", 'turnsOf("5")', 'turnsOf("4")']);
  const count = () => turns;
  const at = what === "table" ? "5" : what === "object" ? "0" : random.pick(["5", "5", "5", "5", "2", "0"]);
  let a = what === "list" && random.chance(0.7) ? random.pick([makers[3], makers[4], ...texts]) : random.pick(makers);
  const b = what === "list" && random.chance(0.6) ? random.pick([makers[1], makers[9]]) : random.pick(makers);
  if (declaredAs) a = b;
  const drawn = random.pick(values);
  const value = isDeclared && /^(undefined|null|"s"|\{\})$/.test(drawn) ? `${drawn} as any` : drawn;
  const apart = (given: string) => `told(() => ${name}(${a}, ${handed(b)}, ${count()}, ${at}, ${given}))`;
  const same = (given: string) =>
    `told(() => ((o${any}) => ${name}(o, ${handed("o")}, ${count()}, ${at}, ${given}))(${b}))`;
  const calls = [apart(plain), apart(value), same(value), same(plain)];
  return { name, text, calls: random.chance(0.7) ? calls : random.shuffled(calls) };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(1, 3) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
