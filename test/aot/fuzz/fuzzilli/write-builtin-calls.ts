// Writes programs of functions that call built-ins in loops. For write-random-builtin-sweep.ts and for a scene of write-ordinary-scenes.ts.
// Receivers are lists, views, strings, numbers, maps, sets, dates, expressions, objects, heirs of the library and lookalikes. They are parameters, fields, elements and variables of the file, and a receiver of another kind comes by now and then.
// Arguments are whole, fractional, negative, missing, too many, strings, objects that count how often they are asked, or callbacks that change what is walked. Some receivers get a member of their own under the name of a built-in.
// Each program prints every result and what the receivers hold at its end.

type Call = (value: string) => string;

/** The lines of a program, or of a part of one, whose names end in `suffix` and that prints by `print`. */
export function writeBuiltinCalls(next: () => number, isTyped: boolean, print = "console.log", suffix = "") {
  const random = {
    below: (end: number) => Math.floor(next() * end),
    chance: (of: number) => next() < of,
    pick: <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)],
  };
  const indent = (lines: string[]) => lines.flatMap(line => line.split("\n")).map(line => "  " + line);
  const any = isTyped ? ": any" : "";
  const number = isTyped ? ": number" : "";
  let turnName = "turn";
  const whole = () =>
    random.pick(["0", "1", "2", "3", "-1", "-2", turnName, turnName, "n", `${turnName} + 1`, `n - ${turnName}`]);
  const odd = () =>
    random.pick(["0.5", "NaN", "Infinity", "-Infinity", "undefined", "null", '"1"', '"a"', "true", "[]", "{}", "counted", "2 ** 31", "-0", "1.9"]); // prettier-ignore
  const index = () => (random.chance(0.75) ? whole() : odd());
  const text = () => random.pick(['"a"', '"b"', '","', '""', '"text"', '"é"', '"x"', "String(n)", `"" + ${turnName}`, random.chance(0.3) ? odd() : '"t"']); // prettier-ignore
  const one = () =>
    random.pick(["1", "2", "0.5", '"a"', "undefined", "null", "{}", turnName, "n", "NaN", "true", "[1]", "-0", "kept"]);
  const values = (most: number) => Array.from({ length: random.below(most + 1) }, one).join(", ");
  const callback = () =>
    random.pick([
      `(each${any}) => each`,
      `(each${any}) => each * 2`,
      `(each${any}, at${any}) => at`,
      `(each${any}) => each > 1`,
      `(each${any}) => each === undefined`,
      `(each${any}, at${any}, all${any}) => all.length - at`,
      `(each${any}) => [each, each]`,
      `(each${any}) => String(each)`,
      `(each${any}, at${any}) => (at === ${random.below(3)} ? undefined : each)`,
      `(each${any}, at${any}, all${any}) => {\n  if (at === 1) all.length = 1;\n  return each;\n}`,
      `(each${any}, at${any}, all${any}) => {\n  if (at === 0 && all.length < 9) all.push?.(4);\n  return each;\n}`,
      `(each${any}) => {\n  calls++;\n  return each;\n}`,
      `(each${any}, at${any}) => {\n  if (at > 3) throw new Error("late");\n  return !each;\n}`,
      "Boolean",
      "Number",
      "pickFirst",
      "undefined",
      "parseInt",
    ]);
  const comparison = () =>
    random.pick(["undefined", `(a${any}, b${any}) => a - b`, `(a${any}, b${any}) => b - a`, `(a${any}, b${any}) => (a < b ? -1 : a > b ? 1 : 0)`, `(a${any}, b${any}) => String(a).length - String(b).length`]); // prettier-ignore
  const folding = () =>
    random.pick([`(sum${any}, each${any}) => sum + each`, `(sum${any}, each${any}, at${any}) => sum + at`, `(sum${any}, each${any}) => (sum > each ? sum : each)`, `(sum${any}, each${any}) => [sum, each].length`]); // prettier-ignore
  const calls: Record<string, Call[]> = {
    list: [
      v => `${v}.push(${values(2)})`,
      v => `${v}.push(${one()})`,
      v => `${v}.pop()`,
      v => `${v}.shift()`,
      v => `${v}.unshift(${values(2)})`,
      v => `${v}.slice(${[index(), index()].slice(0, random.below(3)).join(", ")})`,
      v => `${v}.splice(${[index(), index(), one()].slice(0, 1 + random.below(3)).join(", ")})`,
      v => `${v}.concat(${values(2)})`,
      v => `${v}.concat(${v})`,
      v => `${v}.join(${random.pick(["", text()])})`,
      v => `${v}.indexOf(${one()}${random.chance(0.3) ? ", " + index() : ""})`,
      v => `${v}.lastIndexOf(${one()}${random.chance(0.3) ? ", " + index() : ""})`,
      v => `${v}.includes(${one()}${random.chance(0.3) ? ", " + index() : ""})`,
      v => `${v}.at(${index()})`,
      v => `${v}.fill(${[one(), index(), index()].slice(0, 1 + random.below(3)).join(", ")})`,
      v => `${v}.reverse()`,
      v => `${v}.sort(${comparison()})`,
      v => `${v}.toSorted(${comparison()})`,
      v => `${v}.toReversed()`,
      v => `${v}.toSpliced(${index()}, ${whole()})`,
      v => `${v}.with(${index()}, ${one()})`,
      v => `${v}.copyWithin(${index()}, ${index()})`,
      v => `${v}.flat(${random.pick(["", "2", "0", "Infinity"])})`,
      v => `${v}.flatMap(${callback()})`,
      v => `${v}.map(${callback()})`,
      v => `${v}.filter(${callback()})`,
      v => `${v}.forEach(${callback()})`,
      v => `${v}.some(${callback()})`,
      v => `${v}.every(${callback()})`,
      v => `${v}.find(${callback()})`,
      v => `${v}.findIndex(${callback()})`,
      v => `${v}.findLast(${callback()})`,
      v => `${v}.findLastIndex(${callback()})`,
      v => `${v}.reduce(${folding()}${random.chance(0.6) ? ", " + one() : ""})`,
      v => `${v}.reduceRight(${folding()}${random.chance(0.6) ? ", " + one() : ""})`,
      v => `[...${v}.keys()]`,
      v => `[...${v}.entries()]`,
      v => `[...${v}.values()].length`,
      v => `${v}.length`,
      v => `(${v}.length = ${random.pick(["1", "2", "0", "3"])})`,
      v => `[...${v}]`,
      v => `Array.isArray(${v})`,
      v => `Array.from(${v}${random.chance(0.4) ? ", " + (isTyped ? `(${callback()}) as any` : callback()) : ""})`,
      v => `Math.max(...${v})`,
      v => `Object.keys(${v}).length`,
      v => `JSON.stringify(${v})`,
      v => `String(${v})`,
      v => `Array.prototype.slice.call(${v}, ${whole()})`,
      v => `[].concat(${v}, ${one()})`.replace("[]", isTyped ? "([] as any[])" : "[]"),
      v => `Array.of(${v}, ${values(2)}).length`,
    ],
    view: [
      v => `${v}.subarray(${index()}, ${index()})`,
      v => `${v}.set([${random.pick(["1", "1, 2", "300", "0.5"])}]${random.chance(0.5) ? ", " + index() : ""})`,
      v =>
        `${v}.fill(${[random.pick(["1", "300", "-1", "0.5", "NaN"]), index()].slice(0, 1 + random.below(2)).join(", ")})`,
      v => `${v}.indexOf(${one()})`,
      v => `${v}.at(${index()})`,
      v => `${v}.map(${random.pick([`(each${any}) => each * 2`, `(each${any}, at${any}) => at`])})`,
      v => `${v}.slice(${index()})`,
      v => `${v}.join()`,
      v => `${v}.length + ${v}.byteLength`,
      v => `${v}.sort()`,
      v => `${v}.reduce(${folding()}, 0)`,
      v => `Array.from(${v})`,
      v => `${v}.copyWithin(${index()}, ${index()})`,
      v => `${v}.toSorted().at(-1)`,
      v => `${v}.with(${whole()}, 7)`,
      v => `${v}.findLast(${callback()})`,
      v => `new Float64Array(${v})`,
    ],
    string: [
      v => `${v}.charAt(${index()})`,
      v => `${v}.charCodeAt(${index()})`,
      v => `${v}.codePointAt(${index()})`,
      v => `${v}.at(${index()})`,
      v => `${v}.slice(${[index(), index()].slice(0, random.below(3)).join(", ")})`,
      v => `${v}.substring(${[index(), index()].slice(0, 1 + random.below(2)).join(", ")})`,
      v => `${v}.substr(${index()}, ${index()})`,
      v => `${v}.indexOf(${text()}${random.chance(0.4) ? ", " + index() : ""})`,
      v => `${v}.lastIndexOf(${text()}${random.chance(0.4) ? ", " + index() : ""})`,
      v => `${v}.includes(${text()}${random.chance(0.4) ? ", " + index() : ""})`,
      v => `${v}.startsWith(${text()}${random.chance(0.4) ? ", " + index() : ""})`,
      v => `${v}.endsWith(${text()}${random.chance(0.4) ? ", " + index() : ""})`,
      v => `${v}.split(${[text(), whole()].slice(0, random.below(3)).join(", ")})`,
      v => `${v}.split(${random.pick(["/,/", "/(t)/", '""'])})`,
      v =>
        `${v}.replace(${random.pick([text(), "/t/g", "/(.)/", "/[a-c]+/g"])}, ${random.pick([text(), '"$&$1"', `(all${any}) => all + calls++`])})`,
      v => `${v}.replaceAll(${random.pick([text(), "/t/g"])}, ${text()})`,
      v => `${v}.match(${random.pick(["/t/g", "/(.)(.)/", "/z/", "/^./u"])})`,
      v => `[...${v}.matchAll(/[a-z]/g)].length`,
      v => `${v}.search(/[b-t]/)`,
      v => `${v}.concat(${values(2)})`,
      v => `${v}.padStart(${random.pick(["5", whole()])}, ${text()})`,
      v => `${v}.padEnd(${random.pick(["6", whole()])})`,
      v => `${v}.repeat(${random.pick(["2", "0", "1.9", `${turnName} & 3`])})`,
      v => `${v}.trim().length`,
      v => `${v}.toUpperCase()`,
      v => `${v}.toLowerCase()`,
      v => `${v}.normalize("NFD").length`,
      v => `${v}.length`,
      v => `${v}[${whole()}]`,
      v => `[...${v}]`,
      v => `Number(${v})`,
      v => `parseInt(${v}, ${random.pick(["10", "16", "36", "2", "undefined"])})`,
      v => `parseFloat(${v})`,
      v => `encodeURIComponent(${v})`,
      v => `JSON.stringify(${v})`,
      v => `${v}.localeCompare === undefined`,
      v => `${v} < ${text()}`,
      v => `${v}.isWellFormed()`,
      v => `String.raw\`\${${v}}\``,
      v => `new RegExp("[" + ${v}.slice(0, 1).replace(/\\W/g, "") + "a]").test(${v})`,
    ],
    number: [
      v => `${v}.toString(${random.pick(["", "2", "16", "36", "10"])})`,
      v => `${v}.toFixed(${random.pick(["", "0", "2", "10"])})`,
      v => `${v}.toPrecision(${random.pick(["", "1", "5", "21"])})`,
      v => `${v}.toExponential(${random.pick(["", "0", "3"])})`,
      ...["floor", "ceil", "round", "trunc", "abs", "sign", "sqrt", "cbrt", "fround", "clz32", "log2", "log10", "exp", "expm1", "log1p", "sin", "atan", "tanh"].map(name => (v: string) => `Math.${name}(${v})`), // prettier-ignore
      v => `Math.max(${v}, ${index()})`,
      v => `Math.min(${index()}, ${v}, ${whole()})`,
      v => `Math.pow(${v}, ${random.pick(["2", "0.5", "-1", "0"])})`,
      v => `Math.hypot(${v}, ${whole()})`,
      v => `Math.imul(${v}, ${random.pick(["3", "2 ** 31", "-1"])})`,
      v => `Math.atan2(${v}, ${whole()})`,
      v => `Number.isInteger(${v})`,
      v => `Number.isSafeInteger(${v})`,
      v => `Number.isNaN(${v})`,
      v => `isNaN(${v})`,
      v => `isFinite(${v})`,
      v => `String(${v})`,
      v => `Object.is(${v}, ${random.pick(["-0", "0", "NaN", "1"])})`,
      v => `parseInt(${isTyped ? `(${v} as any)` : v})`,
      v => `new Array(${v} & 3).length`,
      v => `"abc".charAt(${v})`,
      v => `String.fromCharCode(${v})`,
      v => `BigInt(Math.trunc(${v}))`,
      v => `[1, 2, 3].at(${v})`,
      v => `new Date(${v}).getTime()`,
    ],
    map: [
      v => `${v}.get(${one()})`,
      v => `${v}.has(${one()})`,
      v => `${v}.set(${one()}, ${one()}).size`,
      v => `${v}.delete(${one()})`,
      v => `${v}.size`,
      v => `[...${v}.keys()]`,
      v => `[...${v}.entries()]`,
      v =>
        `${v}.forEach((each${any}, key${any}, all${any}) => {\n  if (calls++ < 20 && key === 1) all.delete(key);\n})`,
      v => `new Map(${v}).size`,
      v => `Object.fromEntries(${v})`,
      v => `Array.from(${v}, ([key, each]${isTyped ? ": any" : ""}) => key)`,
      v => `${v}.clear()`,
    ],
    set: [
      v => `${v}.has(${one()})`,
      v => `${v}.add(${one()}).size`,
      v => `${v}.delete(${one()})`,
      v => `${v}.size`,
      v => `[...${v}]`,
      v => `[...${v}.union(new Set([1, 9]))]`,
      v => `${v}.isSubsetOf(new Set([1, 2, 3]))`,
      v => `[...${v}.intersection(new Set([1, "a"]))]`,
      v => `${v}.forEach((each${any}) => {\n  if (calls++ < 9) ${v}.add(calls);\n})`,
      v => `Array.from(${v}).length`,
    ],
    object: [
      v => `Object.keys(${v})`,
      v => `Object.values(${v})`,
      v => `Object.entries(${v}).length`,
      v => `Object.assign(${v}, { ${random.pick(["a: 1", "b: turnOf(2)", "size: 3", "length: 2"])} })`,
      v =>
        `Object.assign({}, ${v}).a`.replace(
          "Object.assign({}",
          isTyped ? "Object.assign({} as any" : "Object.assign({}",
        ),
      v => `({ ...${v}, z: 1 })`,
      v => `Object.freeze(${v}) === ${v}`,
      v => `Object.isFrozen(${v})`,
      v => `Object.getOwnPropertyNames(${v})`,
      v => `Object.getOwnPropertyDescriptor(${v}, "${random.pick(["a", "length", "size"])}")?.value`,
      v => `Object.hasOwn(${v}, ${random.pick(['"a"', '"length"', whole()])})`,
      v => `${v}.hasOwnProperty?.(${random.pick(['"a"', '"length"', whole()])})`,
      v => `Reflect.ownKeys(${v}).length`,
      v => `Reflect.get(${v}, ${random.pick(['"a"', '"length"', whole()])})`,
      v => `Reflect.set(${v}, ${random.pick(['"a"', '"b"', whole()])}, ${one()})`,
      v => `Reflect.has(${v}, "a")`,
      v =>
        `Object.defineProperty(${v}, "${random.pick(["a", "c"])}", { value: ${one()}, configurable: true, writable: true, enumerable: ${random.pick(["true", "false"])} })`,
      v => `delete ${v}.${random.pick(["a", "b"])}`,
      v => `JSON.stringify(${v})`,
      v => `JSON.stringify(${v}, null, 1)`,
      v => `JSON.parse(JSON.stringify(${v}) ?? "null")`,
      v => `structuredClone(${v})`,
      v => `Object.groupBy([1, 2, 3], (each${any}) => (each & 1 ? "odd" : "even"))`,
      v => `"a" in ${v}`,
      v => `${v}.toString === Object.prototype.toString`,
      v => `Object.getPrototypeOf(${v}) === Array.prototype`,
      v => `Object.entries(${v}).map(([key]) => key).join()`,
    ],
    other: [
      v =>
        `Array.from({ length: ${random.pick(["2", "n", whole()])} }, ${isTyped ? `(${callback()}) as any` : callback()})`,
      v => `Array.from(new Set([${values(3)}]))`,
      v => `(${isTyped ? `[${values(3)}] as any[]` : `[${values(3)}]`}).includes(${v})`,
      v => `new Set([${v}, ${values(2)}]).size`,
      v => `new Map([[${v}, 1]]).get(${v})`,
      v => `String(Symbol(${text()}))`,
      v => `BigInt.asUintN(8, 300n + BigInt(${turnName}))`,
      v => `Number(${v})`,
      v => `Boolean(${v})`,
      v => `typeof ${v}`,
      v => `[${v}].flat(3).length`,
      v => `Object(${v}) === ${v}`,
      v => `new Date(Date.UTC(2020, ${turnName}, 1)).toISOString()`,
      v => `/a(b)?/.exec(${isTyped ? `(${text()}) as any` : text()})?.index`,
      v => `[${v}, ${v}].indexOf(${v})`,
      v => `decodeURIComponent(encodeURIComponent(${text()}))`,
    ],
  };
  const receivers: Record<string, string[]> = {
    list: ["[1, 2, 3]", "[0.5, 2, 1]", '["b", "a"]', "[3, 1, 2, 5, 4]", "[]", "[1, , 3]", '[1, "a", null, undefined]', "[[1], [2, 3]]", "Object.freeze([1, 2])", "new Heir(1, 2, 3)", "Array.from({ length: 5 }, (_, at) => at)", "new Array(3)", "JSON.parse('[1,2,3]')", "new Proxy([1, 2], {})", "[-0, NaN, 0]", "Object.assign([1, 2], { extra: 1 })"], // prettier-ignore
    view: ["new Uint8Array([1, 2, 255])", "new Float64Array([0.5, NaN, 2])", "new Int32Array(4)", "new Uint8ClampedArray([5, 300])", "new Uint16Array(new ArrayBuffer(8), 2, 2)"], // prettier-ignore
    string: [
      '"text"',
      '"a,b,c"',
      '""',
      '"éü日本"',
      '"12.5px"',
      '"  x "',
      'new String("abc")',
      '"😀a"',
      '"0x1f"',
      '"aaaa"',
    ],
    number: [
      "1",
      "0",
      "-0",
      "2.5",
      "-1.5",
      "NaN",
      "Infinity",
      "255",
      "2147483648",
      "1e21",
      "new Number(7)",
      "0.1",
      "-7",
    ],
    map: ["new Map([[1, 2], [2, 3]])", 'new Map([["a", 1]])', "new Map()", "new Map([[NaN, 1], [0, -0]])"],
    set: ["new Set([1, 2])", "new Set()", 'new Set(["a", 1, NaN])'],
    object: ["{ a: 1, b: 2 }", "{}", "{ length: 2, 0: 1, 1: 2 }", "new Pair(1, 2)", "Object.create({ a: 5 })", "Object.create(null)", "{ get a() { return ++calls; } }", "[1, 2]", 'Object.defineProperty({ a: 2 }, "toJSON", { value: () => 8 })', "{ 2: 1, 1: 2, a: 3 }"], // prettier-ignore
    other: ["null", "undefined", "true", "5n", '"text"', "7", "[1]", "{ a: 1 }"],
  };
  const lines: string[] = [
    `let calls${number} = 0;`,
    `const counted${any} = { valueOf() { return ++calls & 3; } };`,
    `const kept${any} = { a: 1 };`,
    `const turnOf = (value${any})${any} => value;`,
    `function pickFirst(first${any})${any} {\n  return first;\n}`,
    isTyped ? "class Heir extends Array<any> {}" : "class Heir extends Array {}",
    isTyped
      ? "class Pair {\n  a: any;\n  b: any;\n  constructor(a: any, b: any) {\n    this.a = a;\n    this.b = b;\n  }\n}"
      : "class Pair {\n  constructor(a, b) {\n    this.a = a;\n    this.b = b;\n  }\n}",
    `function show(value${any}, depth${number} = 0)${isTyped ? ": string" : ""} {`,
    '  if (typeof value === "function") return "function";',
    '  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value);',
    '  if (depth > 3) return "deep";',
    '  if (value instanceof Map || value instanceof Set) return "{" + Array.from(value, (each' +
      any +
      ') => show(each, depth + 1)).join() + "}";',
    '  if (Array.isArray(value) || ArrayBuffer.isView(value)) return "[" + Array.from(value as any, (each) => show(each, depth + 1)).join() + "]" + (Object.keys(value).length - (value as any).length);'
      .replaceAll(" as any", isTyped ? " as any" : "")
      .replace("(each)", `(each${any})`),
    '  return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + (Object.getOwnPropertyDescriptor(value, key)' +
      (isTyped ? "!" : "") +
      '.get ? "get" : show(value[key], depth + 1))).join() + "}";',
    "}",
    `let total${any} = "";`,
    `function note(value${any}) {`,
    '  total = (total + "|" + show(value)).slice(-600);',
    "}",
  ];
  const kinds = Object.keys(receivers);
  const functionCount = 1 + random.below(3);
  const chosen: string[] = [];
  const runs: string[] = [];
  for (let at = 0; at < functionCount; at++) {
    const kind = random.pick([...kinds, "list", "list", "string", "number", "object"]);
    chosen.push(kind);
    const other = random.pick(kinds);
    const depth = random.pick([0, 1, 1, 1, 2]);
    turnName = depth === 0 ? "n" : "turn";
    const before: string[] = [];
    const place = random.pick(["value", "value", "value", "holder.value", "values[0]", "same", "shared"]);
    if (place === "holder.value") before.push(`const holder${any} = { value };`);
    if (place === "values[0]")
      before.push(`const values${isTyped ? ": any[]" : ""} = [value, ${random.pick(receivers[kind])}];`);
    if (place === "same") before.push(`const same${any} = value;`);
    if (place === "shared") before.push("shared = value;");
    const call = (): string => {
      const [from, of] = random.chance(0.85)
        ? [kind, place]
        : [random.pick([kind, other]), random.pick(["value", place])];
      if (kind === "view" && random.chance(0.4)) return random.pick(calls.list)(of);
      return random.pick(calls[from])(of);
    };
    const statement = (): string[] => {
      const made = call();
      const wrapped = isTyped && made.startsWith("{") ? `(${made})` : made;
      const result = random.pick([
        () => `note(${wrapped});`,
        () => `note(${wrapped});`,
        () => `sum += ${isTyped ? `(${wrapped}) as any` : `(${wrapped})`};`,
        () => `if (${isTyped && /^[[({]|^new /.test(wrapped) ? `turnOf(${wrapped})` : wrapped}) sum += 1;`,
        () => `last = ${wrapped};`,
        () => `last = ${wrapped};\nnote(last);`,
        () => `kinds += typeof (${wrapped});`,
        () => `if (last !== (${wrapped})) calls += 1;`,
      ])();
      const lines = result.split("\n");
      if (random.chance(0.1)) return ["try {", ...indent(lines), "} catch (error) {", `  note((error${isTyped ? " as any" : ""}).name);`, "}"]; // prettier-ignore
      if (depth > 0 && random.chance(0.15))
        return [`if (turn ${random.pick(["=== 1", "> 1", "& 1"])}) {`, ...indent(lines), "}"];
      return lines;
    };
    let body = Array.from({ length: 1 + random.below(4) }, statement).flat();
    if (depth > 0 && random.chance(0.15) && (kind === "list" || kind === "object" || kind === "map" || kind === "set"))
      body.push(`if (turn === ${1 + random.below(2)}) ${isTyped ? "(value as any)" : "value"}.${random.pick(kind === "list" ? ["push", "map", "slice", "join", "indexOf", "length"] : ["get", "has", "a", "size", "toString"])} = ${random.pick(["() => 7", "2", "undefined"])};`); // prettier-ignore
    if (depth > 0 && random.chance(0.12) && !before.some(line => /^const same/.test(line)))
      body.push(`if (turn === ${1 + random.below(2)}) value = ${random.pick(receivers[random.pick([kind, other])])};`);
    if (depth === 2) body = ["for (let inner = 0; inner < 2; inner++) {", ...indent(body), "}"];
    if (depth > 0) body = [random.pick(["for (let turn = 0; turn < n; turn++) {", "for (let turn = 0; turn < n; turn++) {", "for (let turn = n; turn > 0; turn--) {", "for (const turn of [0, 1, 2]) {"]), ...indent(body), "}"]; // prettier-ignore
    const uses = (word: string) => body.some(line => new RegExp(`\\b${word}\\b`).test(line));
    const form = random.pick(["function", "function", "function", "arrow", "async", "method"]);
    const textOf = [
      ...(uses("sum") ? [`let sum${any} = 0;`] : []),
      ...(uses("last") ? [`let last${any};`] : []),
      ...(uses("kinds") ? ['let kinds = "";'] : []),
      ...before,
      ...body,
      `return [${["sum", "last", "kinds"].filter(uses).join(", ")}];`,
    ];
    const valueType = isTyped ? ": any" : "";
    const head = `(value${valueType}, n${number})`;
    if (form === "async")
      lines.push(`async function work${at}${head}${isTyped ? ": Promise<any>" : ""} {`, ...indent(textOf), "}");
    else if (form === "arrow") lines.push(`const work${at} = ${head}${any} => {`, ...indent(textOf), "};");
    else if (form === "method")
      lines.push(`class Worker${at} {`, `  static work${head}${any} {`, ...indent(indent(textOf)), "  }", "}");
    else lines.push(`function work${at}${head}${any} {`, ...indent(textOf), "}");
    for (let count = 1 + random.below(4); count > 0; count--) {
      const receiver = random.pick(receivers[random.chance(0.85) ? kind : other]);
      const given = `given, ${random.pick(["1", "2", "3", "4", "5"])}`;
      const called = form === "async" ? `await work${at}(${given})` : form === "method" ? `Worker${at}.work(${given})` : `work${at}(${given})`; // prettier-ignore
      runs.push(
        ...["{", `  const given${any} = ${receiver};`, "  try {", `    console.log(show(${called}), show(given), total);`, "  } catch (error) {", `    console.log("threw", (error${isTyped ? " as any" : ""})?.name, show(given), total);`, "  }", '  total = "";', "}"], // prettier-ignore
      );
    }
  }
  if (lines.some(line => /\bshared\b/.test(line))) lines.splice(1, 0, `let shared${any};`);
  lines.push(...runs, "console.log(calls, show(kept));");
  const ownNames = /\b(?:work\d|Worker\d|calls|counted|kept|turnOf|pickFirst|Heir|Pair|show|total|note|shared)\b/g;
  return {
    name: chosen.join("-"),
    lines: lines
      .flatMap(line => line.split("\n"))
      .map(line => line.replaceAll("console.log(", print + "("))
      .map(line => (suffix ? line.replace(ownNames, name => name + suffix) : line)),
  };
}
export const writeSceneOfBuiltinCalls = (random: () => number, n: number, isTypeScript: boolean): string[] =>
  writeBuiltinCalls(random, isTypeScript, "printValue", "_" + n).lines;
