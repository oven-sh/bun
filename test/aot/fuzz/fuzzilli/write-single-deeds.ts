// Scenes of one deed each, a few lines long. Each table holds what people write every day and a generator of random operations seldom puts together:
// something that can be walked goes into something that walks it; a view is read beside its length in a loop; a literal holds closures and is changed on a way that is never taken;
// closures of a function that runs once are lent, kept or thrown; a function is looked at as an object; a method is called under a name out of a walk; a field is laid by a definition and stored plainly.
// `typed` writes an annotation in TypeScript and nothing in JavaScript.
type Draw = {
  pick: <T>(from: readonly T[]) => T;
  chance: (percent: number) => boolean;
  typed: (type: string) => string;
  cast: (type: string) => string;
  isTypeScript: boolean;
  n: number;
};

/** Keeps a function from being copied into its caller. */
const work = "let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;";

/** What can be walked, and what walks it: three to six pairs, each with a list of its own. */
function walkedSources(draw: Draw): string[] {
  const { pick, chance, typed, cast, n } = draw;
  const lines = new Set<string>();
  // What a build leaves out because nothing reaches it comes back with any second use: half of the scenes are one pair, with nothing around it.
  const isBare = chance(50);
  for (let pair = isBare ? 1 : pick([3, 4, 5, 6]); pair > 0; pair--) {
    const id = `${n}_${pair}`;
    const needsPairs = chance(30);
    const items = needsPairs ? pick(['["a", 1], ["b", 2], ["a", 3]', "[1, 2], [3, 4]", '["k", null]']) : pick(["4, 5, 4", "1.5, 2, 1.5", '"a", "b", "a"', "1, , 1", "null, undefined, 0", "7"]); // prettier-ignore
    const text = JSON.stringify(`[${items.replace(", ,", ", null,").replace("undefined", "null")}]`);
    const whole = items.replace(", ,", ", 0,");
    const list = pick([`[${items}]`, `[${items}]`, `JSON.parse(${text})`, `JSON.parse(${text})`, `JSON.parse(${text})`, `Object.freeze([${items}])`, `Object.seal([${items}])`, `[${items}].slice()`, `[${items}].map(each => each)`, `structuredClone([${items}])`, `Array.of(${whole})`, `[${items}].concat([])`, `Array.from([${items}])`, `new (class extends Array {})(${whole})`]); // prettier-ignore
    const source = pick(["L", "L", "L", "L.values()", "L.values()", "L.values()", "L.keys()", "L.entries()", "L[Symbol.iterator]()", "new Set(L)", "new Set(L).values()", "given(...L)", "given(...L)", "rest(...L)", "parts`a${1}b${2}a`", "process.execArgv.concat(L)", "Object.values(L)", "Object.entries(L)", "(function* () { yield* L; })()", "L.values().map(each => each)", "Iterator.from(L)", "{ [Symbol.iterator]: () => L.values() }", "L.toReversed()", "L.flat()"]); // prettier-ignore
    const sink = pick(
      needsPairs
        ? ["new Map(@@).size", "[...new Map(@@)].join()", 'new Map(@@).get("a")', "JSON.stringify(Object.fromEntries(@@))", "new Map(@@).has(1)"]
        : ["new Set(@@).size", "new Set(@@).size", "[...new Set(@@)].join()", "new Uint8Array(@@).join()", "Uint8Array.from(@@).length", "new Float64Array(@@).join()", "Array.from(@@).length", "[...@@].join()", "Math.max(...@@)", "count(...@@)", '(([first, second]) => first + "|" + second)(@@)', "Buffer.from(@@).length", "new Set(@@).has(4)", '(() => { let sum = ""; for (const each of @@) sum += each; return sum; })()', "Array.from(@@, each => each).join()", "new Set(@@).union(new Set([9])).size"], // prettier-ignore
    );
    if (source.startsWith("given")) lines.add(`function given()${typed("any")} { return arguments; }`);
    if (source.startsWith("rest")) lines.add(`function rest(...all${typed("any[]")}) { return all; }`);
    if (source.startsWith("parts"))
      lines.add(`function parts(texts${typed("any")}, ...values${typed("any[]")}) { return texts; }`);
    if (sink.startsWith("count")) lines.add(`function count(...all${typed("any[]")}) { return all.length; }`);
    const said = (name: string) => sink.replaceAll("@@", `(${source.replaceAll("L", name)}${cast("any")})`);
    const caught = `catch (error) { printValue("walked ${id} threw", (error${cast("any")})?.constructor?.name); }`;
    if (isBare) {
      lines.add(`const held${id}${typed("any")} = ${list};`);
      lines.add(`printValue(${said(`held${id}`)});`);
    } else if (chance(50)) {
      lines.add(`function walk${id}(held${typed("any")}) { ${chance(50) ? work : ""} return ${said("held")}; }`);
      lines.add(`try { printValue("walked ${id}", walk${id}(${list})); } ${caught}`);
    } else {
      lines.add(`const held${id}${typed("any")} = ${list};`);
      lines.add(`try { printValue("walked ${id}", ${said(`held${id}`)}); } ${caught}`);
    }
  }
  return [...lines];
}

/** A view is read and stored in a loop, beside its length, its bytes or a call. Most views are as they were made. */
function viewsInLoops({ pick, chance, typed, cast, isTypeScript, n }: Draw): string[] {
  const not = isTypeScript ? "!" : "";
  const View = pick([
    "Uint8Array",
    "Uint8Array",
    "Int32Array",
    "Int32Array",
    "Float64Array",
    "Uint16Array",
    "Int8Array",
  ]);
  const odd = pick([
    ...(View === "Uint8Array" ? ["Buffer.from([1, 2, 3])", "Buffer.from([1, 2, 3])", "Buffer.alloc(3, 2)"] : []),
    `new (class Frame extends ${View} {})([1, 2, 3])`,
    `new (class Frame extends ${View} {})([1, 2, 3])`,
    `Object.defineProperty(new ${View}([1, 2, 3]), "length", { value: 3 })`,
    `Object.defineProperty(new ${View}([1, 2, 3]), "length", { value: 2 })`,
    `Object.setPrototypeOf(new ${View}([1, 2, 3]), Object.create(${View}.prototype))`,
    `new ${View}(new ArrayBuffer(3 * ${View}.BYTES_PER_ELEMENT, { maxByteLength: 64 }))`,
    `new ${View}([0, 1, 2, 3, 4]).subarray(1, 4)`,
    `new ${View}(new SharedArrayBuffer(3 * ${View}.BYTES_PER_ELEMENT))`,
    `new ${View}(0)`,
    `Object.assign(new ${View}([1, 2, 3]), { extra: 1 })`,
    `(() => { const view = new ${View}([1, 2, 3]); view.buffer.transfer(); return view; })()`,
  ]);
  const beside = pick([
    "view.length",
    "view.length",
    "view.length",
    "view.byteLength",
    "view.byteOffset + 1",
    "view.BYTES_PER_ELEMENT",
    "view.at(0)" + not,
    "1",
  ]);
  const deed = pick([
    `sum = (sum + view[i]${not} * ${beside}) | 0;`,
    `sum = (sum + view[i]${not} * ${beside}) | 0;`,
    `sum += view[i]${not} * ${beside};`,
    `sum += view[i]${not} / ${beside};`,
    `view[i] = view[i]${not} * ${beside}; sum += view[i]${not};`,
    `view[i] = view[i]${not} * ${beside}; sum += view[i]${not};`,
    `if (view[i] === undefined) sum += 1000; else sum += view[i]${not} + ${beside};`,
    `sum += ${beside}; sum += view[i]${not};`,
    `view[i] = i + ${beside}; sum += view[i]${not};`,
  ]);
  const bound = pick(["n", "n", "n", "view.length", "view.length", "n + 1"]);
  const call = pick(["each(i); ", "each(i); ", "each(i); ", "", "", "heard += i; "]);
  return [
    `let heard = 0;`,
    ...(call.startsWith("each") ? [pick([`const each${typed("(i: number) => void")} = [(i${typed("number")}) => { heard += i; }][JSON.parse("0")];`, `function each(i${typed("number")})${typed("void")} { ${work} heard += i + work; }`])] : []), // prettier-ignore
    `function total${n}(view${typed(View)}, n${typed("number")})${typed("number")} { let sum = 0; for (let i = 0; i < ${bound}; i++) { ${call}${deed} } return sum; }`,
    ...(chance(40) ? [`(globalThis${cast("any")})[JSON.parse('"kept${n}"')] = total${n};`] : []),
    `for (let round = 0; round < ${pick([1, 2, 2, 50])}; round++) {`,
    `  const said = [total${n}(new ${View}([1, 2, 3]), 3), total${n}(${odd}${cast("any")}, 3), total${n}(new ${View}([4, 5, 6]), 3)].join();`,
    `  if (round < 2) printValue("views ${n}", said, heard);`,
    `}`,
  ];
}

/** A literal holds closures over a variable beside a member that comes out of a call. On a way that is never taken, the literal is changed. */
function literalsWithClosures({ pick, chance, typed, cast, n }: Draw): string[] {
  const box = pick([
    "choose(3)",
    "choose(3)",
    '"text" + count',
    "[count]",
    "{ inner: count }",
    "[1, 2].at(-1)",
    "[1, 2].find(each => each > 1)",
    "maker.make(3)",
    "count * 2",
    "null",
    "() => count",
  ]);
  const members = [`note: 1`, `read: () => count`, `add: () => ++count`, `box: ${box}`];
  if (chance(40)) members.push(members.splice(pick([0, 1, 2]), 1)[0]);
  const never = pick(["Date.now() < 5", "Date.now() < 5", "process.exitCode === 77", "count > 100"]);
  const change = pick([
    "delete full.note;",
    "delete full.note;",
    "delete full.box;",
    'Object.defineProperty(full, "box", { get() { return 0; } });',
    "Object.freeze(full);",
    "full.more = 1;",
    "full.box = undefined;",
    "Object.setPrototypeOf(full, null);",
    "kept.push(full);",
    'delete full[["no", "te"].join("")];',
  ]);
  const looks = pick([
    [
      `const found = full.box;`,
      `printValue("literal ${n}", typeof found, "box" in full, full.add(), full.read(), Object.keys(full).join());`,
    ],
    [`const found = full.box;`, `printValue("literal ${n}", typeof found, "box" in full, full.add(), full.read());`],
    [`printValue("literal ${n}", typeof full.box, full.add(), full.read());`],
    [`const { box, add } = full;`, `printValue("literal ${n}", typeof box, add(), full.read());`],
    [`printValue("literal ${n}", JSON.stringify(full), full.add());`],
  ]);
  const isAsync = chance(15);
  return [
    `class Crate${n} { size${typed("number")}; constructor(size${typed("number")}) { this.size = size; } }`,
    `function wide${n}(size${typed("number")}) { ${work} return new Crate${n}(size + work); }`,
    `function narrow${n}(size${typed("number")}) { ${work} return new Crate${n}(size - work); }`,
    `const choose = Date.now() > 5 ? wide${n} : narrow${n};`,
    `const maker = { make(size${typed("number")}) { return choose(size); } };`,
    `const kept${typed("unknown[]")} = [];`,
    `${isAsync ? "async " : ""}function main${n}() {`,
    `  ${work}`,
    `  let count = 5;`,
    ...(isAsync ? [`  await null;`] : []),
    `  const full${typed("any")} = { ${members.join(", ")} };`,
    ...looks.map(line => "  " + line),
    `  if (${never}) ${change}`,
    ...(chance(50) ? [`  printValue("literal ${n} behind", typeof full.box, Object.keys(full).length);`] : []),
    `}`,
    ...pick([
      [`${isAsync ? "await " : ""}main${n}();`],
      [`${isAsync ? "await " : ""}main${n}();`],
      [`for (let turn = 0; turn < 3; turn++) ${isAsync ? "await " : ""}main${n}();`],
    ]),
  ];
}

/** Closures over the variables of a function that runs once, or a few times: one is kept by its callee, one is only called, one is thrown, one is made on each side of a test. */
function closuresOfOneRun({ pick, chance, typed, cast, n }: Draw): string[] {
  const any = typed("any");
  const deeds = [
    [
      `install((x${any}) => (x + near) | 0);`,
      `printValue("once ${n}", handlers[0](1));`,
      `printValue("once ${n}", borrow((x${any}) => (x + far) | 0));`,
      `printValue("once ${n}", handlers[0](1));`,
    ],
    [
      `printValue("once ${n}", borrow((x${any}) => (x + far) | 0));`,
      `install((x${any}) => (x + near + far) | 0);`,
      `near = 7;`,
      `printValue("once ${n}", handlers[0](1));`,
    ],
    [
      `try { throw () => near; } catch {}`,
      `install(() => (near * 2) | 0);`,
      `printValue("once ${n}", handlers[0](1));`,
    ],
    [
      `try { throw () => near; } catch (thrown) { handlers.push(thrown${cast("any")}); }`,
      `near = (near + 1) | 0;`,
      `printValue("once ${n}", handlers[0]());`,
    ],
    [
      `let use${any};`,
      `if (typeof given === "number") use = () => given * 2; else use = () => given + "!";`,
      `handlers.push(use);`,
      `printValue("once ${n}", use());`,
    ],
    [`const read = () => (near + far) | 0;`, `near = 100;`, `handlers.push(read);`, `printValue("once ${n}", read());`],
    [
      `const early = () => late();`,
      `const late = () => near;`,
      `handlers.push(early);`,
      `printValue("once ${n}", early());`,
    ],
    [
      `const bump = () => (near = (near + 1) | 0);`,
      `handlers.push(bump);`,
      `printValue("once ${n}", bump(), bump(), near);`,
    ],
    [
      `for (let turn = 0; turn < 3; turn++) { const mine = near + turn; install(() => mine); }`,
      `printValue("once ${n}", handlers.map(each => each(0)).join());`,
    ],
    [
      `const pair = { get: () => near, set: (value${any}) => { near = value; } };`,
      `borrow(pair.set);`,
      `handlers.push(pair.get);`,
      `printValue("once ${n}", pair.get());`,
    ],
  ];
  return [
    `const handlers${typed("any[]")} = [];`,
    `function install(callback${any}) { ${work} handlers.push(${pick(["(x" + any + ") => callback(x)", "callback", "callback"])}); return work; }`,
    `function borrow(callback${any}) { ${work} return (work + callback(2)) | 0; }`,
    `function boot${n}(given${any}) {`,
    ...(chance(50) ? [`  ${work}`] : []),
    `  let near = 0;`,
    `  let far = 0;`,
    `  for (let i = 0; i < 4; i++) { near = (near + i) | 0; far = (far + 1000) | 0; }`,
    ...pick(deeds).map(line => "  " + line),
    `}`,
    ...pick([
      [`boot${n}(JSON.parse('"abc"'));`],
      [`boot${n}(JSON.parse("21"));`],
      [`boot${n}(21);`, `boot${n}("abc");`],
    ]),
    `printValue("once ${n} behind", handlers.map(each => { try { return each(1); } catch { return "threw"; } }).join());`,
  ];
}

/** A function of the program is called many times by value, and is looked at as an object once. */
function functionsLookedAt({ pick, chance, typed, cast, n }: Draw): string[] {
  const any = typed("any");
  const made = pick([`function tag${n}() { ${work} return work + 6; }`, `const tag${n} = () => 6;`, `const tag${n} = function () { return 6; };`, `const tag${n} = { tag() { return 6; } }.tag;`, `class Tag${n} { static tag() { return 6; } }\nconst tag${n} = Tag${n}.tag;`]); // prettier-ignore
  const look = pick([
    `Object.keys(@@).length`,
    `(() => { let names = ""; for (const name in @@) names += name; return names; })()`,
    `(() => { try { structuredClone(@@); return "cloned"; } catch (error) { return (error${cast("any")}).name; } })()`,
    `Reflect.ownKeys(@@).join()`,
    `@@ instanceof Function`,
    `typeof @@.prototype`,
    `(() => { try { return typeof new (@@${cast("any")})(); } catch (error) { return (error${cast("any")}).name; } })()`,
    `Object.getOwnPropertyNames(@@).sort().join()`,
    `@@.name + @@.length`,
    `((@@${cast("any")}).extra = 1, Object.keys(@@).join())`,
    `Object.isFrozen(Object.freeze(@@))`,
    `new WeakSet([@@]).has(@@)`,
    `JSON.stringify({ @@ })`,
    `Object.getPrototypeOf(@@) === Function.prototype`,
    `@@.hasOwnProperty("name")`,
    `@@.bind(null)()`,
  ]).replaceAll("@@", `tag${n}`);
  const through = pick([`list.forEach(visit);`, `list.forEach(visit);`, `Array.from(list, visit);`, `list.sort((a${any}, b${any}) => (visit(a), 0));`, `list.map(visit);`, `for (const each of list) visit(each);`, `visit(list[0]); visit(list[1]);`]); // prettier-ignore
  return [
    ...made.split("\n"),
    `let sum = 0;`,
    `function visit(f${any}) { ${work} sum += f() + work; }`,
    `function go(fn${any}) { const list = [fn, fn]; for (let t = 0; t < ${pick([1, 5, 50])}; t++) { ${through} } return sum; }`,
    `let latest = 0;`,
    `for (let turn = 0; turn < ${pick([1, 3, 60])}; turn++) latest = go(tag${n});`,
    `printValue("function ${n}", latest);`,
    `printValue("function ${n}", String(${look}));`,
    `for (let turn = 0; turn < 3; turn++) latest = go(tag${n});`,
    `printValue("function ${n}", latest);`,
  ];
}

/** A method is called under a name that comes out of a walk over a record, a list or a text. */
function methodsByWalkedNames({ pick, typed, cast, n }: Draw): string[] {
  const any = typed("any");
  const [start, steps] = pick<[string, string]>([
    ["[1, 2]", "{ flatMap: (n" + any + ") => [n, n * 10], findLast: (n" + any + ") => n > 5 }"],
    ["[3, 1, 2]", "{ toSorted: undefined, map: (n" + any + ') => n * 2, join: "-" }'],
    ['"a-b"', '{ split: "-", reverse: undefined, join: "+" }'],
    ["[1, 2, 3]", "{ filter: (n" + any + ") => n > 1, reduce: (a" + any + ", b" + any + ") => a + b }"],
    ["new Set([1, 2])", "{ union: new Set([3]), has: 3 }"],
    ["new Map([[1, 2]])", "{ get: 1, toFixed: 1 }"],
    ['" x "', "{ trim: undefined, padEnd: 3, at: -1 }"],
    ["[[1], [2]]", "{ flat: undefined, includes: 2 }"],
  ]);
  const walk = pick([
    `for (const step in steps) value = value[step](steps[step]);`,
    `for (const step in steps) value = value[step](steps[step]);`,
    `for (const step of Object.keys(steps)) value = value[step](steps[step]);`,
    `for (const [step, given] of Object.entries(steps)) value = value[step](given);`,
    `Object.keys(steps).forEach(step => { value = value[step](steps[step]); });`,
    `for (const step of Reflect.ownKeys(steps)) value = Reflect.apply(value[step], value, [steps[step]]);`,
  ]);
  return [
    `const steps${n}${any} = ${steps};`,
    `function run${n}(given${any}) { const steps = steps${n}; let value = given; ${walk} return value; }`,
    `try { printValue("steps ${n}", String(run${n}(${start}))); } catch (error) { printValue("steps ${n} threw", (error${cast("any")})?.constructor?.name); }`,
  ];
}

/** A field that a definition lists, a getter of a literal, or nothing, and a plain store from elsewhere that makes or replaces it. The objects are then read in a loop. */
function fieldsLaidAndStored({ pick, chance, typed, cast, isTypeScript, n }: Draw): string[] {
  const any = typed("any");
  const lays = pick([
    `Object.defineProperty(row, "mark", { value: 7 + work });`,
    `Object.defineProperty(row, "mark", { value: 7 + work, writable: true });`,
    `Object.defineProperty(row, "mark", { get() { return 7; }, configurable: true });`,
    `Object.defineProperties(row, { mark: { value: 7, enumerable: true } });`,
    `Reflect.defineProperty(row, "mark", { value: 7 + work, writable: true, configurable: true });`,
    `row.mark = 7 + work;`,
    `delete row.mark;`,
  ]);
  const isCalled = chance(35);
  const maker = pick([
    [
      `class Row${n} { size${any}; ${isTypeScript ? "mark: any; " : ""}constructor(n${any}) { ${work} this.size = n + 1; } seal() { ${work} hide(this); return work; } }`,
      `new Row${n}(i)`,
    ],
    [
      `class Row${n} { size${any}; ${isTypeScript ? "declare mark: any; " : ""}constructor(n${any}) { this.size = n + 1; } seal() { hide(this); return 0; } }`,
      `new Row${n}(i)`,
    ],
    [
      `function make${n}(n${any})${any} { return { size: n + 1, get mark() { return -1; }, seal() { hide(this); return 0; } }; }`,
      `make${n}(i)`,
    ],
    [
      `function make${n}(n${any})${any} { return { size: n + 1, set mark(value${any}) {}, seal() { hide(this); return 0; } }; }`,
      `make${n}(i)`,
    ],
    [`function make${n}(n${any})${any} { return { size: n + 1, seal() { hide(this); return 0; } }; }`, `make${n}(i)`],
  ]);
  const store = pick([`row.mark = i;`, `row.mark = i;`, `row["mark"] = i;`, `Object.assign(row, { mark: i });`, `Object.defineProperty(row, "mark", { value: i, writable: true, enumerable: true, configurable: true });`, `if (i & 1) row.mark = i;`]); // prettier-ignore
  return [
    `function hide(row${any}) { ${work} ${lays} }`,
    maker[0],
    `function fill${n}(count${any}) { const rows${typed("any[]")} = []; for (let i = 0; i < count; i++) { const row${any} = ${maker[1]}; ${store} rows.push(row); } return rows; }`,
    `function total${n}(rows${typed("any[]")}) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i].mark + rows[i].size; return sum; }`,
    `function main${n}() {`,
    `  ${work}`,
    `  const rows = fill${n}(${pick([3, 30, 3000])});`,
    `  const before = total${n}(rows);`,
    ...(isCalled
      ? [
          `  try { rows[1].seal(); } catch (error) { printValue("rows ${n} threw", (error${cast("any")})?.constructor?.name); }`,
        ]
      : []),
    `  try { rows[2].mark = 70 + work; } catch (error) { printValue("rows ${n} threw", (error${cast("any")})?.constructor?.name); }`,
    `  printValue("rows ${n}", before, total${n}(rows), rows[2].mark, Object.keys(rows[1]).join());`,
    `}`,
    `main${n}();`,
  ];
}

/** The own keys of an object of the host or the language, behind a walk, a pattern or a copy that names none of them. */
function keysBehindWalks({ pick, cast, n }: Draw): string[] {
  const holder = pick([
    "Object",
    "Object",
    "Reflect",
    "JSON",
    "Math",
    "Number",
    "String",
    "Symbol",
    "Promise",
    "Array",
    "Bun",
    "process",
    "console",
    "Date",
    "Atomics",
    "Intl",
  ]);
  const other = pick(["Bun", "Bun", "process", "Object", "globalThis", "console", "Reflect", "Number"]);
  const first = pick([
    `for (const key in ${other}) break;`,
    `for (const key in ${other}) break;`,
    `Object.keys(${other}).length;`,
    `const { ...copy } = ${other}${cast("any")};`,
    `void ("nothing" in ${other});`,
    `void Object.getOwnPropertyDescriptor(${other}, "nothing");`,
    ``,
  ]);
  const member = { Object: "assign", Reflect: "get", JSON: "parse", Math: "abs", Number: "isInteger", String: "raw", Symbol: "for", Promise: "all", Array: "of", Bun: "version", process: "platform", console: "log", Date: "now", Atomics: "load", Intl: "Collator" }[holder]!; // prettier-ignore
  const second = pick([
    `const { ${member}: taken, ...rest } = ${holder}${cast("any")};`,
    `const { ${member}: taken, ...rest } = ${holder}${cast("any")};`,
    `const taken = ${holder}.${member};`,
    `const rest = { ...${holder} };`,
    `const rest = Object.assign({}, ${holder});`,
    `void Object.entries(${holder}).length;`,
    ``,
  ]);
  return [first, second, `printValue("keys ${n}", Reflect.ownKeys(${holder}).map(String).join());`].filter(Boolean);
}

/** A variable of the file is read by a function that runs before the statement that stores it: through a wrapper as bundlers write it, a hook, a hoisted function. Then it is stored and read again. */
function variablesReadEarly({ pick, chance, typed, cast, isTypeScript, n }: Draw): string[] {
  const any = typed("any");
  const value = pick([
    "heard.length + 40",
    "heard.length + 40",
    '["fresh"]',
    '"text" + heard.length',
    "{ size: heard.length }",
    "() => heard.length",
    "heard.length + 0.5",
    "null",
  ]);
  const keyword = pick(["var", "var", "var", "let"]);
  const look = pick([
    `function look() { ${work} return total; }`,
    `function look() { ${work} return total; }`,
    `function look() { return total; }`,
    `function look() { ${work} if (total === undefined) total = []${cast("any")}; return total; }`,
    `const look = () => total;`,
    `function look() { ${work} return typeof total + ":" + (total === undefined); }`,
  ]);
  const early = pick([
    [
      `var wrap = (run${any}, made${isTypeScript ? "?: any" : ""}) => () => (made || run((made = { exports: {} }).exports, made), made.exports);`,
      `var inner = wrap((exports${any}, module${any}) => { exports.kind = typeof look(); exports.text = String(look()); });`,
      `printValue("early ${n}", inner().kind, inner().text);`,
    ],
    [
      `var wrap = (run${any}, made${isTypeScript ? "?: any" : ""}) => () => (made || run((made = { exports: {} }).exports, made), made.exports);`,
      `var inner = wrap((exports${any}, module${any}) => { heard.push(() => look()); exports.done = 1; });`,
      `inner();`,
      `for (const hook of heard) printValue("early ${n}", String(hook()));`,
    ],
    [`printValue("early ${n}", typeof look(), String(look()));`],
    [`heard.push(look);`, `printValue("early ${n}", String(heard[0]()));`],
    [`class Early${n} { static seen = String(look()); }`, `printValue("early ${n}", Early${n}.seen);`],
    [`[0].forEach(() => printValue("early ${n}", String(look())));`],
  ]);
  const body = [
    ...early,
    `total = ${value};`,
    `printValue("late ${n}", typeof look(), JSON.stringify(look()) ?? "none");`,
  ];
  return [
    `const heard${typed("any[]")} = [];`,
    ...(look.startsWith("const")
      ? [`${keyword} total${any};`, look]
      : chance(50)
        ? [`${keyword} total${any};`, look]
        : [look, `${keyword} total${any};`]),
    ...(keyword === "let" || chance(30)
      ? [
          `try {`,
          ...body.map(line => "  " + line),
          `} catch (error) { printValue("early ${n} threw", (error${cast("any")})?.constructor?.name); }`,
        ]
      : body),
  ];
}

/** A class whose parent hands back what it is given lays its fields over an object that somebody else made: over a getter, a setter, a plain member, a frozen object, nothing. */
function fieldsLaidOverObjects({ pick, typed, cast, isTypeScript, n }: Draw): string[] {
  const any = typed("any");
  const member = pick([
    "get level() { return 1; }",
    "get level() { return 1; }",
    `set level(value${any}) {}`,
    "level: 1",
    "level: 1.5",
    'level: "low"',
    "other: 1",
    "level() { return 1; }",
  ]);
  const made = pick([`{ id: id + work, ${member} }`, `{ id: id + work, ${member} }`, `{ ${member}, id: id + work }`, `Object.freeze({ id: id + work, ${member} })`, `Object.create({ ${member} })`, `new (class { id = id; ${member.startsWith("level:") || member.startsWith("other:") ? member.replace(":", " =") + ";" : member} })()`]); // prettier-ignore
  const field = pick([
    "level = 7;",
    "level = 7;",
    "level = 7.5;",
    'level = "high";',
    "level;",
    "level = () => 7;",
    "static level = 7; level = 8;",
    "#hidden = 1; level = 7;",
  ]);
  return [
    `class Passing${n} { constructor(target${any}) { return target; } }`,
    `class Leveled${n} extends Passing${n} { ${isTypeScript ? field.replace(/^level;/, "level: any;") : field} constructor(target${any}) { super(target); } }`,
    `function gauge${n}(id${any})${any} { ${work} return ${made}; }`,
    `function level${n}(gauge${any}) { ${work} return String(typeof gauge.level === "function" ? gauge.level() : gauge.level) + work; }`,
    `function turn${n}(round${any}) { ${work} const gauge = gauge${n}(round); const before = level${n}(gauge); try { new Leveled${n}(gauge); } catch (error) { return before + (error${cast("any")}).constructor.name; } return before + "|" + level${n}(gauge) + "|" + Object.keys(gauge).join(); }`,
    `let said = "";`,
    `for (let round = 0; round < ${pick([1, 3, 200])}; round++) said = turn${n}(round);`,
    `printValue("laid ${n}", said, turn${n}(1), String((new Leveled${n}({ north: 1 })${cast("any")}).level));`,
  ];
}

/** A closure is handed to itself, to a callee that stores it, or comes in the place of nothing now and then; behind many calls it is looked at as an object. */
function closuresHandedOn({ pick, typed, cast, n }: Draw): string[] {
  const any = typed("any");
  const handler = pick([`(self${any}, box${any}) => { box.last = self; return 5; }`, `(self${any}, box${any}) => { box.last = self; return 5; }`, `function (self${any}, box${any}) { box.last = self; return 5; }`, `(self${any}, box${any}) => { box.last = () => self; return 5; }`, `(self${any}, box${any}) => { box.all.push(self); return 5; }`, `(self${any}, box${any}) => (box.last === self ? 6 : ((box.last = self), 5))`]); // prettier-ignore
  const look = pick(["Object.keys(onRead).length", "Object.getOwnPropertyNames(onRead).length", "(() => { let names = 0; for (const name in onRead) names++; return names; })()", "typeof onRead.name", "onRead.length", "Reflect.ownKeys(onRead).length", "String(first.last === onRead)"]); // prettier-ignore
  return [
    `const onRead${any} = ${handler};`,
    `function run${n}(handler${any}, box${any}) { ${work} const got = handler(handler, box); return got + work; }`,
    `const first${any} = { last: undefined, tag: 1, all: [] };`,
    `const second${any} = { last: undefined, tag: 2, all: [] };`,
    `let total = 0, missed = 0;`,
    `for (let turn = 0; turn < ${pick([3, 60, 300])}; turn++) {`,
    `  try { total += run${n}(${pick(["turn % 50 === 49 ? undefined : onRead", "turn % 50 === 49 ? undefined : onRead", "onRead", "turn & 1 ? onRead : onRead.bind(null)"])}, turn & 1 ? first : second); }`,
    `  catch (error) { missed += (error${cast("any")}).name === "TypeError" ? 1 : 100; }`,
    `}`,
    `printValue("handed ${n}", total, missed);`,
    `printValue("handed ${n}", ${look}, run${n}(onRead, first), typeof first.last);`,
  ];
}

/** A built-in is called in a loop with an operand of a kind that it refuses or converts. */
function builtInsGivenOtherKinds({ pick, typed, cast, n }: Draw): string[] {
  const any = typed("any");
  const call = pick([
    "Reflect.has(@A, @B)", "Reflect.has(@A, @B)", "Reflect.get(@A, @B)", "Reflect.ownKeys(@A)", "Reflect.getPrototypeOf(@A)", "Object.keys(@A)", "Object.entries(@A)", "Object.getPrototypeOf(@A)", "Object.create(@A)",
    "Object.defineProperty(@A, @B, {})", "Object.assign(@A, @B)", "Object.fromEntries(@A)", "new Set(@A)", "new Map(@A)", "new WeakSet().add(@A)", "new WeakMap().set(@A, @B)", "Array.from(@A)", "Array.prototype.slice.call(@A)",
    "JSON.parse(@A)", "Symbol.keyFor(@A)", "@B in @A", "@A instanceof @B", "new @A()", "@A()", "@A.length", "@A[@B]", "structuredClone(@A)", "String.prototype.at.call(@A, 0)", "Number.prototype.toFixed.call(@A)", "BigInt(@A)",
    "Math.max(@A, @B)", "[].concat(@A)", "[...A]", "Promise.resolve.call(@A)", "Function.prototype.call.call(@A)", "new Proxy(@A, {})", "Object.setPrototypeOf(@A, @B)", "@A.toString()", "`${@A}`", "@A + @B", "encodeURIComponent(@A)",
  ]); // prettier-ignore
  const given = pick([
    "i",
    "i",
    "i + 0.5",
    "String(i)",
    "i > 1",
    "undefined",
    "null",
    "Symbol.iterator",
    "BigInt(i)",
    "[i]",
    "{ i }",
    "() => i",
  ]);
  return [
    `const given${any} = JSON.parse('{"three":3,"text":"label"}');`,
    `const notes${typed("string[]")} = [];`,
    `function scene${n}(s${any}) { const three${typed("number")} = given.three; for (let i = 0; i < three; i++) { notes.push("turn" + i); const got${any} = ${call.replaceAll("@A", `(${given}${cast("any")})`).replaceAll("@B", "s")}; notes.push(typeof got === "object" ? JSON.stringify(got) : String(got)); } }`,
    `try { scene${n}(given.text); notes.push("no error"); } catch (error) { notes.push(error instanceof Error ? error.name + ": " + error.message : String(error)); }`,
    `printValue("given ${n}", notes.join(" "));`,
  ];
}

/** JavaScript that stays a script. A name is looked up through a `with`: the object gains it, loses it, hides it, or answers through an accessor or a proxy, also while it is asked. */
function namesThroughWith({ pick, n }: Draw): string[] {
  const shelf = pick([
    "{ item: 0, get [Symbol.unscopables]() { asked++; delete shelf.item; return null; } }",
    "{ item: 0, get [Symbol.unscopables]() { asked++; return { item: asked > 1 }; } }",
    "{ item: 0, [Symbol.unscopables]: { item: true } }",
    "{ get item() { asked++; return asked; } }",
    "{ get item() { asked++; delete shelf.item; return 5; } }",
    "new Proxy({ item: 0 }, { has(target, key) { asked++; return asked < 2 && key in target; } })",
    "new Proxy({ item: 0 }, { get(target, key) { asked++; return key === Symbol.unscopables ? undefined : 9; } })",
    "Object.create({ item: 3 })",
    "{ other: 1 }",
    "{ item: 0 }",
  ]);
  const use = pick([
    '(function () { "use strict"; got = item; })();',
    '(function () { "use strict"; got = item; })();',
    "got = item;",
    "item = 4; got = item;",
    "got = typeof item;",
    "got = (() => item)();",
    "item++; got = item;",
    "got = delete item;",
    "var item = 6; got = item;",
    "shelf.item = 8; got = item;",
    "delete shelf.item; got = typeof item;",
    "for (let turn = 0; turn < 3; turn++) got += item;",
    "got = item + item;",
    "function read() { return item; } got = read();",
  ]);
  return [
    "// stays a script",
    "var asked = 0;",
    `var shelf = ${shelf};`,
    `var got = "nothing";`,
    ...(pick([true, false, false]) ? ["var item = -1;"] : []),
    `with (shelf) {`,
    `  try { ${use} printValue("no error"); } catch (error) { printValue(error.name); }`,
    `}`,
    `printValue("with ${n}", asked, String(got), Object.keys(shelf).join(), typeof globalThis.item);`,
  ];
}

/** A list that is typed as a class holds one object that no constructor made. A field to which the class gives one value, always, holds another there. It is read, cast, and used behind a few branches. */
function impostorsAmongInstances({ pick, chance, typed, cast, n }: Draw): string[] {
  const [type, born] = pick<[string, string]>([["any", "null"], ["any", "null"], ["any", "undefined"], ["string | null", "null"], ["unknown", "null"], ["number", "0"], ["boolean", "false"], ["string", '""'], ["any", "0"]]); // prettier-ignore
  const other = pick(['"right"', '"right"', '"right"', "7", "true", '{"a":1}', "1.5", "[]"]);
  const impostor = pick([
    `JSON.parse('{"skip":false,"weight":3,"mark":${other}}')`,
    `JSON.parse('{"skip":false,"weight":3,"mark":${other}}')`,
    `JSON.parse('{"mark":${other},"weight":3,"skip":false}')`,
    `JSON.parse('{"skip":false,"weight":3}')`,
    `Object.assign(Object.create(Item${n}.prototype), { skip: false, weight: 3, mark: ${other} })`,
    `{ ...new Item${n}(false, 3), mark: ${other} }`,
    `Object.assign(new Item${n}(false, 3), JSON.parse('{"mark":${other}}'))`,
  ]);
  const read = pick([
    "item.mark",
    "item.mark",
    "item.mark",
    `markOf${n}(item)`,
    `item["mark"]`,
    "(({ mark }) => mark)(item)",
  ]);
  const use = pick([
    "table[name]",
    "table[name]",
    "table[name]",
    "table[name]",
    "table[name]",
    "table[name]",
    'name + "!"',
    "String(name)",
    "typeof name",
    "name === null",
    "(name ? 1 : 2)",
    "JSON.stringify([name])",
    "`${name}`",
  ]);
  const asked = pick(["string", "string", "string", "number", "any"]);
  const steps = [
    `const item = list[at];`,
    `const mark = ${read};`,
    `if (item.skip) return "skipped";`,
    `const weight = item.weight;`,
    `const name = mark${cast(asked)};`,
    `if (at > 90) return "far";`,
  ];
  if (chance(25)) steps.splice(4, 2, steps[5], steps[4]);
  if (chance(20)) steps.splice(2, 1);
  return [
    `class Item${n} { skip${typed("boolean")}; weight${typed("number")}; mark${typed(type)} = ${born}; constructor(skip${typed("boolean")}, weight${typed("number")}) { this.skip = skip; this.weight = weight; } }`,
    ...(read.startsWith("markOf")
      ? [`function markOf${n}(item${typed(`Item${n}`)})${typed("any")} { return item.mark; }`]
      : []),
    `function drive${n}(list${typed(`Item${n}[]`)}, table${typed("Record<string, number>")}, at${typed("number")})${typed("string")} {`,
    `  ${work}`,
    ...steps.map(line => "  " + line),
    ...(chance(80)
      ? [
          `  let sum = work;`,
          `  sum = (sum * 3 + at) | 0;`,
          `  sum = (sum * 5 + at) | 0;`,
          `  sum = (sum * 7 + at) | 0;`,
        ]
      : [`  const sum = 0;`]),
    `  return (${use}) + ":" + (sum & 0) + ":" + weight;`,
    `}`,
    `const items${n}${typed(`Item${n}[]`)} = [new Item${n}(false, 2), ${impostor}, new Item${n}(false, 5)];`,
    `const table${n}${typed("Record<string, number>")} = { null: 1, right: 2, undefined: 3, 0: 4, false: 5, 7: 6 };`,
    `let said = "";`,
    `for (let round = 0; round < ${pick([1, 3, 300])}; round++) said = drive${n}(items${n}, table${n}, 0) + " " + drive${n}(items${n}, table${n}, 1) + " " + drive${n}(items${n}, table${n}, 2);`,
    `printValue("impostor ${n}", said);`,
  ];
}

/** A few files that import each other: statements, names, requires, import() that is awaited or not, cycles. Each says when its body begins and ends. */
function graphsOfModules({ pick, chance, n }: Draw): string[] {
  const count = pick([3, 4, 5, 6, 9]);
  const files = Array.from({ length: count }, (_, at) => ({ name: `m${n}_${at}`, isScript: at > 0 && chance(30) }));
  const path = (at: number) => `./${files[at].name}.${files[at].isScript ? "cjs" : "mjs"}`;
  const body = (at: number) => {
    const lines = [`console.log("begins ${at}");`];
    for (let edges = pick([0, 1, 1, 2, 2, 3]); edges > 0; edges--) {
      // Mostly onward, so that most graphs are trees with a few edges back.
      const to = chance(75) ? Math.min(count - 1, at + 1 + pick([0, 0, 1, 2])) : pick(files.map((_, each) => each));
      if (to === at || to === 0) continue;
      lines.push(
        files[at].isScript
          ? pick([`require("${path(to)}");`, `require("${path(to)}");`, `globalThis.late${n} = import("${path(to)}");`, `import("${path(to)}").then(() => console.log("came ${at} ${to}"));`, `queueMicrotask(() => console.log("job ${at}"));`])
          : pick([`import "${path(to)}";`, `import "${path(to)}";`, `import "${path(to)}";`, `import * as all${to}_${edges} from "${path(to)}"; console.log(typeof all${to}_${edges});`, `await import("${path(to)}");`, `import("${path(to)}").then(() => console.log("came ${at} ${to}"));`, `export * from "${path(to)}";`]), // prettier-ignore
      );
    }
    lines.push(`console.log("ends ${at}");`);
    return lines;
  };
  const [, ...rest] = files;
  return [...body(0), ...rest.flatMap((_, at) => [`// @filename: ${path(at + 1)}`, ...body(at + 1)])];
}

/** A store under a key that a call hands out: a symbol, undefined, null, a number, a text that is put together out of sight. The objects are of one shape or of a few, and have fields of such names. */
function storesUnderHandedKeys({ pick, chance, typed, cast, n }: Draw): string[] {
  const any = typed("any");
  const key = () =>
    pick([
      "sign",
      "sign",
      "undefined",
      "undefined",
      "null",
      '["o", "t", "h", "e", "r"].join("")',
      "0",
      '"0"',
      "NaN",
      "true",
      "-0",
      "1.5",
      '{ toString() { return "other"; } }',
      "show.mark",
      '""',
    ]);
  const [one, other] = [key(), key()];
  const keys = `i & 1 ? ${one} : ${other}`;
  // Most of the time one of the keys, made a text, is the name of a field.
  const field =
    /^(?:undefined|null|NaN|true|0)$/.test(other) && chance(70)
      ? other
      : pick(["undefined", "undefined", "null", "NaN", "true", "0", "front"]);
  const shapes = pick([1, 2, 5, 5, 6]);
  const read = /^\d/.test(field) ? `holder[${field}]` : `holder.${field}`;
  const store = pick([`holder[keyFor(i)] = "laid";`, `holder[keyFor(i)] = "laid";`, `holder[keyFor(i)] = i;`, `holder[keyFor(i)] += 1;`, `delete holder[keyFor(i)];`, `Object.defineProperty(holder, keyFor(i), { value: "laid", enumerable: true, configurable: true, writable: true });`, `Reflect.set(holder, keyFor(i), "laid");`]); // prettier-ignore
  return [
    `const sign = Symbol.for("made.up.mark");`,
    ...(keys.includes("show.mark")
      ? [`function show(value${any}) { return "shown " + value; }`, `show.mark = sign${cast("any")};`]
      : []),
    `function keyFor(i${any})${any} { return ${keys}; }`,
    `function lay(holder${any}, i${any}) { ${work} ${store} }`,
    `function twice(n${any}) { ${work} return n + n; }`,
    `function makeHolder(i${any})${any} {`,
    `  switch (i % ${shapes}) {`,
    ...Array.from(
      { length: shapes - 1 },
      (_, at) => `    case ${at}: return { ${field}: i, other: i + 1, ${"abcdef"[at]}: 0 };`,
    ),
    `    default: return { ${field}: i, other: i + 1, z: 0 };`,
    `  }`,
    `}`,
    `const lines${typed("string[]")} = [];`,
    `for (let i = 0; i < ${pick([4, 120])}; i++) {`,
    ...(keys.includes("show.mark")
      ? [`  if (i === 3) (show${cast("any")})[["m", "a", "r", "k"].join("")] = ["o", "t", "h", "e", "r"].join("");`]
      : []),
    `  const holder = makeHolder(i);`,
    `  lay(holder, i);`,
    `  if (i < 6 || i > 116) lines.push([i, twice(${read}), twice(holder.other), String(holder[sign])${chance(40) ? ', Reflect.ownKeys(holder).map(String).join("+")' : ""}].join(" "));`,
    `}`,
    `printValue("handed keys ${n}", lines.join("|"));`,
  ];
}

/** An async function awaits what a small plain function hands back. In that small function a read goes through an object that is not what its type says, or is not there. */
function awaitsOfSmallCalls({ pick, typed, cast, isTypeScript, n }: Draw): string[] {
  const not = isTypeScript ? "!" : "";
  const impostor = pick([
    "{ reading: 3 }",
    "{ reading: 3 }",
    '{ reading: "three" }',
    `JSON.parse('{"reading":3,"unit":"m"}')`,
    "undefined",
    "{ unit: 1 }",
    "Object.create({ reading: 3 })",
    "{ get reading() { return 3; } }",
  ]);
  const real = pick([
    `async function real(x${typed("unknown")}) { await null; return "real " + x; }`,
    `async function real(x${typed("unknown")}) { await null; return "real " + x; }`,
    `async function real(x${typed("unknown")}) { return "real " + x; }`,
    `function real(x${typed("unknown")}) { return Promise.resolve("real " + x); }`,
    `function real(x${typed("unknown")}) { return { then(done${typed("(value: string) => void")}) { done("real " + x); } }; }`,
    `function real(x${typed("unknown")}) { return new Promise${isTypeScript ? "<string>" : ""}(done => setTimeout(done, 1, "real " + x)); }`,
  ]);
  const taken = pick([
    [`const got = await ask();`],
    [`const got = await ask();`],
    [`const got = await ask();`],
    [`const [got] = await Promise.all([ask(), ask()]);`],
    [`let got${typed("unknown")}; for await (const each of [ask()]) got = each;`],
    [`let got${typed("unknown")}; try { got = await ask(); } finally { heard++; }`],
    [`const got = await (heard >= 0 ? ask() : "none");`],
    [`const asked = ask(); heard++; const got = await asked;`],
    [`const got = (await ask()) + "|" + (await ask());`],
  ]);
  return [
    `class Meter${n} { reading${typed("number")}; unit${typed("string")}; constructor(reading${typed("number")}, unit${typed("string")}) { this.reading = reading; this.unit = unit; } }`,
    `class Pipe${n} { meter${typed(`Meter${n} | undefined`)}; name${typed("string")}; constructor(name${typed("string")}, meter${typed(`Meter${n} | undefined`)}) { this.name = name; this.meter = meter; } }`,
    `const given${typed("unknown[]")} = [new Meter${n}(1, "m"), ${impostor}];`,
    `let current${typed(`Pipe${n}`)} = new Pipe${n}("p", given[0]${cast(`Meter${n}`)});`,
    `let heard = 0;`,
    real,
    `function ask() { return real(current.meter${not}.reading); }`,
    `async function byCopy() { ${taken.join(" ")} return typeof got + " " + String(got); }`,
    `const tell = async () => { try { printValue("awaited ${n}", await byCopy(), heard); } catch (error) { printValue("awaited ${n} threw", (error${cast("any")})?.constructor?.name); } };`,
    `for (let turn = 0; turn < ${pick([1, 1, 3, 100])}; turn++) if (turn < 2) await tell(); else await byCopy();`,
    `current = new Pipe${n}("q", given[1]${cast(`Meter${n}`)});`,
    `await tell();`,
    `await tell();`,
  ];
}

/** Whether a file is a CommonJS file hangs on what is left of it once tests that can be computed are computed. The file says whether its functions are strict. */
function kindsOfFilesBehindComputedTests({ pick, cast, n }: Draw): string[] {
  const [before, test] = pick<[string, string]>([
    ["enum Shelf { Low = 4 }\nenum Shelf { High = Shelf.Low + 1 }", "Shelf.High === 5"],
    ["enum Shelf { Low = 4, High = Shelf.Low + 1 }", "Shelf.High === 5"],
    ["enum Shelf { Low = 4, High = Low + 1 }", "Shelf.High === 5"],
    ['enum Shelf { Low = 4 }\nenum Shelf { High = Shelf["Low"] + 1 }', "Shelf.High === 5"],
    ['enum Shelf { Low = "a" }\nenum Shelf { High = Shelf.Low + "b" }', 'Shelf.High === "ab"'],
    ["const enum Shelf { Low = 4, High = Low << 1 }", "Shelf.High === 8"],
    ["namespace Rack { export enum Shelf { Low = 4, High = Shelf.Low + 1 } }", "Rack.Shelf.High === 5"],
    ["const low = 4;", "low + 1 === 5"],
    ["const low = 4;\nconst high = low + 1;", "high === 5"],
    ["", "4 + 1 === 5"],
    ["", 'typeof 1 === "number"'],
    ["", '"a" + "b" === "ab"'],
    ["", '`a${"b"}` === "ab"'],
    ["", '"ab".length === 2'],
    ["", "void 0 === undefined"],
    ["", "(null ?? true)"],
    ["", "[].length === 0"],
    ["", "Math.max(1, 5) === 5"],
    ["", 'typeof window === "undefined"'],
    ["", 'process.env.NODE_ENV !== "made-up"'],
  ]);
  const guarded = pick([
    `if (${test}) {} else { module.exports = 1; }`,
    `if (${test}) {} else { module.exports = 1; }`,
    `if (!(${test})) { (globalThis as any).seen = require("./nothing-here.cjs"); }`,
    `${test} || (exports.made = 1);`,
    `(${test}) ? 0 : (module.exports = 1);`,
    `if (!(${test})) exports.made = 1;`,
    `function never() { if (${test}) return 0; return module.exports; }`,
    `while (!(${test})) { module.exports = 1; break; }`,
  ]);
  return [
    `await import("./part${n}.ts");`,
    `printValue("kind ${n}", (globalThis${cast("any")}).mode, typeof (globalThis${cast("any")}).seen);`,
    `// @filename: ./part${n}.ts`,
    ...before.split("\n").filter(Boolean),
    guarded,
    `(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();`,
  ];
}

const deeds = {
  storesUnderHandedKeys,
  awaitsOfSmallCalls,
  kindsOfFilesBehindComputedTests,
  impostorsAmongInstances,
  graphsOfModules,
  namesThroughWith,
  variablesReadEarly,
  fieldsLaidOverObjects,
  closuresHandedOn,
  builtInsGivenOtherKinds,
  walkedSources,
  viewsInLoops,
  literalsWithClosures,
  closuresOfOneRun,
  functionsLookedAt,
  methodsByWalkedNames,
  fieldsLaidAndStored,
  keysBehindWalks,
};

/** The names that the scenes share. Each gets the number of its scene, so that a program can hold several scenes at its top level. */
const shared =
  /(?<![.\w$"'`])(?:list|given|rest|parts|count|heard|each|choose|maker|kept|handlers|install|borrow|sum|visit|go|latest|hide|total|look|wrap|inner|said|onRead|first|second|missed|notes|asked|shelf|got|sign|show|keyFor|lay|twice|makeHolder|lines|current|real|ask|byCopy|tell)\b/g;

export function writeSceneOfASingleDeed(
  random: () => number,
  n: number,
  isTypeScript: boolean,
  only?: keyof typeof deeds,
): string[] {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const draw: Draw = { pick, chance: percent => random() * 100 < percent, typed: type => (isTypeScript ? `: ${type}` : ""), cast: type => (isTypeScript ? ` as ${type}` : ""), isTypeScript, n }; // prettier-ignore
  const names = (Object.keys(deeds) as (keyof typeof deeds)[]).filter(
    name => !isTypeScript || name !== "namesThroughWith",
  );
  return deeds[only ?? pick(names)](draw).map(line => line.replace(shared, name => `${name}_${n}`));
}
