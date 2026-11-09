// `Object.defineProperty(h, "m", { get: f }); Object.getOwnPropertyDescriptor(h, "m").get()`: a function is put away somewhere, read back by
// a road that does not name it, and then called. Nothing else in the program calls it, so whoever decides which functions a program can
// reach has to follow that one road. What varies: whether the function is a value, a getter or a setter, how it is written, how it is put
// away (a literal, a store, a definition, a copy, a class, or a helper that gets the holder and the function as parameters and walks over an
// object of functions or lays one: what bundlers write to define the exports of a module), whether the name looks like an index and the
// functions come in a list, whether the key is an object that answers another name each time it is asked, whether the key is known before the
// program runs, by which road it comes back (descriptors, lists of keys or values, copies, destructuring, a read that runs the getter), how
// it is called, and whether putting away and reading back stand in one function or in two.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

export function helpers(typed: boolean): string {
  const any = typed ? ": any" : "";
  return `const unlikely = process.argv.length > 99;
function keyOf(text${typed ? ": string" : ""})${typed ? ": string" : ""} {
  return unlikely ? text + "x" : text;
}
function callIt(g${any}, a${any})${any} {
  return g(a);
}
function told(ask${typed ? ": () => unknown" : ""})${typed ? ": string" : ""} {
  try {
    const answer = ask();
    return typeof answer === "function" ? "a function" : String(answer);
  } catch (error) {
    return (error${typed ? " as Error" : ""}).name;
  }
}
`;
}

type Kind = "value" | "get" | "set";

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const any = typed ? ": any" : "";
  const kind: Kind = random.weighted([
    [5, "value"],
    [4, "get"],
    [2, "set"],
  ] as const);
  const n = random.between(1, 99);
  // One scene in five has a name that looks like an index. It goes by a number that is drawn anyway, so that the other scenes stay as they were.
  const m = n % 10 === 0 ? "0" : n % 5 === 0 ? "1" : "m";
  const dot = m === "m" ? ".m" : `[${m}]`;
  const key = () => (random.chance(0.3) ? `keyOf("${m}")` : `"${m}"`);
  const seen = `${name}S`;
  const body = kind === "value" ? `return a + ${n};` : kind === "get" ? `return ${n};` : `${seen}.push(a + ${n});`;
  const parameters = kind === "get" ? "" : `a${any}`;
  const declared = `${name}F`;
  const written = random.weighted([
    [4, "arrow"],
    [3, "function"],
    [2, "declared"],
    [1, "closure"],
    [1, "bound"],
  ] as const);
  const f =
    written === "arrow"
      ? `(${parameters}) => { ${body} }`
      : written === "function"
        ? `function (${parameters}) { ${body} }`
        : written === "declared"
          ? declared
          : written === "closure"
            ? `((c${any}) => (${parameters}) => { c; ${body} })(${n})`
            : `function (${typed ? `this: any${parameters ? ", " : ""}` : ""}${parameters}) { ${body} }.bind(null)`;
  const declaration = written === "declared" ? `function ${declared}(${parameters}) { ${body} }\n` : "";

  // How it is put away. `isListed`: a walk over the holder's own enumerable members meets it. `isLast`: it is the last of the own keys.
  const slot = kind === "value" ? "value" : kind;
  const described = `{ ${slot}: ${f}, enumerable: true, configurable: true }`;
  const member = kind === "value" ? `${m}(${parameters}) { ${body} }` : `${kind} ${m}(${parameters}) { ${body} }`;
  // A helper of the program's own gets the holder and what is to be laid on it as parameters.
  const helper = `${name}H`;
  const laid = `{ ${slot}: g, enumerable: true${random.chance(0.5) ? ", configurable: true" : ""} }`;
  const walk = random.pick([
    `for (const k in all) { const g = all[k]; LAY }`,
    `for (const k of Object.keys(all)) { const g = all[k]; LAY }`,
    `for (const [k, g] of Object.entries${typed ? "<any>" : ""}(all)) { LAY }`,
    `Object.keys(all).forEach(k => { const g = all[k]; LAY });`,
  ]);
  const lay = random.pick([
    `Object.defineProperty(t, k, ${laid});`,
    `Object.defineProperty(t, k, ${laid});`,
    `Reflect.defineProperty(t, k, ${laid});`,
    kind === "value" ? "t[k] = g;" : `t.__define${kind === "get" ? "Getter" : "Setter"}__(k, g);`,
  ]);
  // As bundlers write it: the function is read out of the object right where it is laid.
  const asBundlersWriteIt = `for (${random.pick(["const", "var", "let"])} k in all) Object.defineProperty(t, k, { ${slot}: all[k], enumerable: true });`;
  const functions = m === "0" && n % 20 === 0 ? `[${f}]` : `{ ${m}: ${f} }`;
  const puts: [weight: number, text: string, isListed: boolean, helper?: string][] = [
    [
      8,
      `const h${any} = {}; ${helper}(h, ${functions});`,
      true,
      `function ${helper}(t${any}, all${any}) { ${asBundlersWriteIt} }\n`,
    ],
    [
      5,
      `const h${any} = {}; ${helper}(h, ${functions});`,
      true,
      `function ${helper}(t${any}, all${any}) { ${walk.replace("LAY", lay)} }\n`,
    ],
    [
      5,
      `const h${any} = {}; ${helper}(h, ${key()}, ${f});`,
      true,
      `function ${helper}(t${any}, k${any}, g${any}) { ${lay} }\n`,
    ],
    [3, `const h${any} = {}; Object.defineProperty(h, ${key()}, ${described});`, true],
    [2, `const h${any} = Object.defineProperties({}, { ${m}: ${described} });`, true],
    [2, `const h${any} = {}; Reflect.defineProperty(h, ${key()}, ${described});`, true],
    [
      4,
      `const all${any} = ${functions}; const h${any} = {}; for (const k in all) Object.defineProperty(h, k, { ${slot}: all[k], enumerable: true });`,
      true,
    ],
    [2, `const h${any} = Object.create(null, { ${m}: ${described} });`, true],
    [3, `const h${any} = { ${member} };`, true],
    [2, `class ${name}C { ${member} } const h${any} = ${name}C.prototype;`, false],
    [2, `class ${name}C { static ${member} } const h${any} = ${name}C;`, false],
  ];
  if (kind === "value")
    puts.push(
      [3, `const h${any} = { ${m}: ${f} };`, true],
      [2, `const h${any} = { [${key()}]: ${f} };`, true],
      [2, `const h${any} = {}; h${dot} = ${f};`, true],
      [2, `const h${any} = {}; h[${key()}] = ${f};`, true],
      [2, `const h${any} = Object.assign({}, { ${m}: ${f} });`, true],
      [2, `const h${any} = { ...{ ${m}: ${f} } };`, true],
      [2, `const h${any} = Object.fromEntries([[${key()}, ${f}]]);`, true],
      [2, `const h${any} = {}; Reflect.set(h, ${key()}, ${f});`, true],
      [2, `const all${any} = ${functions}; const h${any} = {}; for (const k in all) h[k] = all[k];`, true],
    );
  else puts.push([2, `const h${any} = {}; h.__define${kind === "get" ? "Getter" : "Setter"}__(${key()}, ${f});`, true]);
  const [, put, isListed, helperText = ""] = random.weighted(puts.map(entry => [entry[0], entry] as const));

  // The roads that give the function itself.
  const roads: [weight: number, text: string][] = [
    [4, `Object.getOwnPropertyDescriptor(h, ${key()})${typed ? "!" : ""}.${slot}`],
    [3, `Object.getOwnPropertyDescriptors(h)${dot}.${slot}`],
    [3, `Reflect.getOwnPropertyDescriptor(h, ${key()})${typed ? "!" : ""}.${slot}`],
    [2, `Object.getOwnPropertyDescriptor(h, Reflect.ownKeys(h).at(-1)${typed ? "!" : ""})${typed ? "!" : ""}.${slot}`],
    [2, `Object.entries(Object.getOwnPropertyDescriptors(h)).at(-1)${typed ? "!" : ""}[1].${slot}`],
  ];
  if (kind !== "value") roads.push([4, `h.__lookup${kind === "get" ? "Getter" : "Setter"}__(${key()})`]);
  if (kind === "value") {
    roads.push(
      [3, `Reflect.get(h, ${key()})`],
      [3, `h[keyOf("${m}")]`],
      [2, `h[Reflect.ownKeys(h).at(-1)${typed ? " as string" : ""}]`],
      [2, `h[Object.getOwnPropertyNames(h).at(-1)${typed ? "!" : ""}]`],
      [2, `(({ ${m}: g }${any}) => g)(h)`],
      [2, `(({ [${key()}]: g }${any}) => g)(h)`],
    );
    if (isListed)
      roads.push(
        [3, "Object.values(h)[0]"],
        [3, "Object.entries(h)[0][1]"],
        [2, "h[Object.keys(h)[0]]"],
        [2, `{ ...h }${dot}`],
        [2, `Object.assign({}, h)${dot}`],
        [2, "(() => { for (const k in h) return h[k]; })()"],
        [1, `new Map(Object.entries(h)).get("${m}")`],
        [1, "[...Object.values(h)].pop()"],
      );
  }
  const given = kind === "get" ? "" : "5";
  const calls: [weight: number, text: string][] = [
    [4, `f(${given})`],
    [3, `f.call(h${given && ", " + given})`],
    [2, `f.apply(h, [${given}])`],
    [2, `Reflect.apply(f, h, [${given}])`],
    [2, `[f].map((g${any}) => g(${given}))[0]`],
    [2, `f.bind(h)(${given})`],
    [2, `callIt(f, ${given || "0"})`],
  ];
  // The reads and stores that run an accessor without anybody holding it.
  const runs: [weight: number, text: string][] =
    kind === "get"
      ? [
          [3, `Reflect.get(h, ${key()})`],
          [3, `h[keyOf("${m}")]`],
          [2, `h[Reflect.ownKeys(h).at(-1)${typed ? " as string" : ""}]`],
          [2, `(({ ${m}: g }${any}) => g)(h)`],
          ...(isListed
            ? ([
                [3, "Object.values(h)[0]"],
                [2, "Object.entries(h)[0][1]"],
                [2, `{ ...h }${dot}`],
                [2, `Object.assign({}, h)${dot}`],
                [2, "JSON.stringify(h)"],
              ] as [number, string][])
            : []),
        ]
      : kind === "set"
        ? [
            [3, `Reflect.set(h, ${key()}, 5)`],
            [3, `h[keyOf("${m}")] = 5`],
            [2, `Object.assign(h, { ${m}: 5 })`],
            [2, `h[Reflect.ownKeys(h).at(-1)${typed ? " as string" : ""}] = 5`],
          ]
        : [];
  const isHeld = !runs.length || random.chance(0.65);
  const use = isHeld
    ? `const f${any} = ${random.weighted(roads.map(entry => [entry[0], entry[1]] as const))}; const r${any} = ${random.weighted(calls.map(entry => [entry[0], entry[1]] as const))};`
    : `const r${any} = ${random.weighted(runs.map(entry => [entry[0], entry[1]] as const))};`;
  const answer = kind === "set" ? `${seen}.join()` : "r";
  const state = kind === "set" ? `const ${seen}${typed ? ": number[]" : ""} = [];\n` : "";
  const isSplit = random.chance(0.5);
  const text = isSplit
    ? `${state}${declaration}${helperText}function ${name}M()${any} {
  ${put}
  return h;
}
function ${name}(h${any})${any} {
  ${use}
  return ${answer};
}
`
    : `${state}${declaration}${helperText}function ${name}()${any} {
  ${put}
  ${use}
  return ${answer};
}
`;
  // One scene in seven has a key that is an object: each use converts it anew, and it answers "z" the first time and "m" from then on. So
  // one key value names two members, and whoever takes two uses of it for one name takes one function for the other. It goes by the number
  // that is drawn anyway, behind all the draws of a scene, so that the other scenes stay as they were.
  if (n % 7 === 3) {
    const turns = 'c++ ? "m" : "z"';
    const wavering = [
      `{ toString() { return ${turns}; } }`,
      `{ [Symbol.toPrimitive]() { return ${turns}; } }`,
      `{ toString: undefined, valueOf() { return ${turns}; } }`,
      `Object.assign([], { toString() { return ${turns}; } })`,
    ][n % 4];
    const isGetter = n % 2 === 0;
    const from = isGetter
      ? `{ get z() { return ${n}; }, get m() { return ${n + 1000}; } }`
      : `{ z: (a${any}) => a + ${n}, m: (a${any}) => a + ${n + 1000} }`;
    const asked = (holder: string) =>
      isGetter ? `${holder}.m + ":" + ${holder}.z` : `told(() => ${holder}.m(5)) + ":" + told(() => ${holder}.z(5))`;
    const form = [
      `Object.defineProperty(h, w, Object.getOwnPropertyDescriptor(from, w)${typed ? "!" : ""}); return ${asked("h")};`,
      `Reflect.defineProperty(h, w, Reflect.getOwnPropertyDescriptor(from, w)${typed ? "!" : ""}); return ${asked("h")};`,
      `const found = Object.getOwnPropertyDescriptor(from, w); if (found) Object.defineProperty(h, w, found); return ${asked("h")};`,
      `for (const k of [w]) Object.defineProperty(h, k, Object.getOwnPropertyDescriptor(from, k)${typed ? "!" : ""}); return ${asked("h")};`,
      `h[w] = from[w]; return Object.keys(h).join() + ":" + ${isGetter ? 'h.m + ":" + h.z' : asked("h")};`,
      `const f = from[w]; const g = from[w]; return ${isGetter ? 'f + ":" + g' : 'f(5) + ":" + g(5)'};`,
      `const f = Reflect.get(from, w); const g = Reflect.get(from, w); return ${isGetter ? 'f + ":" + g' : 'f(5) + ":" + g(5)'};`,
      `return (w in from) + ":" + Object.hasOwn(from, w) + ":" + ${isGetter ? "from[w]" : "from[w](5)"};`,
    ][Math.floor(n / 7) % 8];
    return {
      name,
      text: `function ${name}()${any} {
  let c = 0;
  const w${any} = ${wavering};
  const from${any} = ${from};
  const h${any} = {};
  ${form}
}
`,
      calls: [`told(() => ${name}())`],
    };
  }
  return { name, text, calls: [`told(() => ${name}(${isSplit ? `${name}M()` : ""}))`] };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(1, 4) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
