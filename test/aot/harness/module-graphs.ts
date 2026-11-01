// Every small graph of modules, and the ways an entry point loads two of them.
// A cell is one graph loaded one way. It prints one line: the order in which its modules run and its promises settle,
// and what they see of each other.
//
// An edge from x to y, in an ES module:
//   S `import "./y"`   N a name of y read while x runs   L a name of y read after everything   E the default import
//   R `export * from`  X `export { name } from`          D `import()` that nobody waits for    A `await import()`
// and in a CommonJS module:
//   Q `require()`, a member read at once   q the member read after everything   Z `const { name } = require()`
//   F `require()` itself after everything  D `import()` that nobody waits for

export const tables = [
  "two",
  "three",
  "one-waits",
  "star",
  "named",
  "loading",
  "throws",
  "four",
  "three-calls",
  "continuations",
  "commonjs",
] as const;
export type Table = (typeof tables)[number];
export type Cell = { id: string; what: string; entry: string; files: Record<string, string> };

type Module = { name: string; file: string; edges: [to: Module, kind: string][]; waits?: boolean; fails?: boolean };

function esModule({ name, edges, waits, fails }: Module) {
  const head: string[] = [];
  const body: string[] = [];
  for (const [{ name: to, file }, kind] of edges) {
    if (kind === "S") head.push(`import "./${file}";`);
    if (kind === "N" || kind === "L") head.push(`import { v${to} } from "./${file}";`);
    if (kind === "N") body.push(`log("${name}:" + v${to});`);
    if (kind === "L") body.push(`later.push(() => log("${name}~" + v${to}));`);
    if (kind === "E") head.push(`import whole${to} from "./${file}";`);
    if (kind === "E") body.push(`log("${name}:" + whole${to}.v${to});`);
    if (kind === "R") head.push(`export * from "./${file}";`);
    if (kind === "X") head.push(`export { v${to} } from "./${file}";`);
    if (kind === "D") body.push(`keep(import("./${file}"));`);
    if (kind === "A") body.push(`await import("./${file}");`);
  }
  return [
    ...head,
    `log("${name}<");`,
    ...(waits ? [`await 0;`, `log("${name}=");`] : []),
    ...body,
    ...(fails ? [`if (tag(1)) throw new Error("${name} fails");`] : []),
    `export const v${name} = tag("${name.toUpperCase()}");`,
    `log("${name}>");`,
    "",
  ].join("\n");
}

function commonJSModule({ name, edges }: Module, replacesExports: boolean) {
  const body: string[] = [];
  for (const [{ name: to, file }, kind] of edges) {
    if (kind === "Q" || kind === "q") body.push(`const got${to} = require("./${file}");`);
    if (kind === "Q") body.push(`log("${name}:" + got${to}.v${to});`);
    if (kind === "q") body.push(`later.push(() => log("${name}~" + got${to}.v${to}));`);
    if (kind === "Z")
      body.push(`const { v${to} } = require("./${file}");`, `later.push(() => log("${name}~" + v${to}));`);
    if (kind === "F") body.push(`later.push(() => log("${name}~" + require("./${file}").v${to}));`);
    if (kind === "D") body.push(`keep(import("./${file}"));`);
  }
  const value = `tag("${name.toUpperCase()}")`;
  return [
    `log("${name}<");`,
    ...body,
    replacesExports ? `module.exports = { v${name}: ${value} };` : `exports.v${name} = ${value};`,
    `log("${name}>");`,
    "",
  ].join("\n");
}

const settles = (promise: string, name: string) =>
  `${promise}.then(() => log("${name}+"), e => log("${name}!" + e.name));`;
const both = (x: string, y: string, gap: string) =>
  `const first = keep(import(${x})); ${gap}const [m, n] = await Promise.all([first, keep(import(${y}))]);`;
const names = (module: string) =>
  `Object.keys(${module}).filter(k => k !== "module.exports" && k !== "__esModule").sort()`;

const third = (y: string) => y.replace("/b.mjs", "/c.mjs");

// `gap`: what stands between the calls, where a way makes several at once.
const ways: Record<string, (x: string, y: string, gap: string) => string> = {
  seq: (x, y) =>
    `const m = await import(${x}); log("x+" + Object.keys(m)); const n = await import(${y}); log("y+" + Object.keys(n));`,
  all: (x, y, gap) => `${both(x, y, gap)} log("all+" + Object.keys(m) + ";" + Object.keys(n));`,
  late: (x, y, gap) => `const p = keep(import(${x})); ${gap}await import(${y}); log("y+"); await p; log("x+");`,
  thens: (x, y, gap) =>
    `const p = keep(import(${x})); ${gap}const q = keep(import(${y})); ${settles("p", "x")} ${settles("q", "y")} await Promise.allSettled([p, q]);`,
  one: x => `const m = await import(${x}); log("x+" + Object.keys(m));`,
  twice: x =>
    `const p = keep(import(${x})), q = keep(import(${x})); ${settles("p", "p")} ${settles("q", "q")} await Promise.allSettled([p, q]); log("one object: " + ((await p) === (await q)));`,
  tick: (x, y) =>
    `const p = keep(import(${x})); ${settles("p", "x")} await null; log("tick"); const q = keep(import(${y})); ${settles("q", "y")} await Promise.allSettled([p, q]);`,
  again: (x, y) =>
    `for (const turn of [1, 2]) try { look(await import(${x})); log("x+"); } catch (e) { log("x!" + e.name); } try { look(await import(${y})); log("y+"); } catch (e) { log("y!" + e.name); }`,
  looks: (x, y, gap) => `${both(x, y, gap)} look(m); look(n);`,
  "all three": (x, y, gap) =>
    `const first = keep(import(${x})); ${gap}const second = keep(import(${y})); ${gap}const [m, n, o] = await Promise.all([first, second, keep(import(${third(y)}))]); log("all+" + Object.keys(m) + ";" + Object.keys(n) + ";" + Object.keys(o));`,
  "thens three": (x, y, gap) =>
    `const p = keep(import(${x})); ${gap}const q = keep(import(${y})); ${gap}const r = keep(import(${third(y)})); ${settles("p", "x")} ${settles("q", "y")} ${settles("r", "z")} await Promise.allSettled([p, q, r]);`,
};

const waysWithRequire: Record<string, (x: string, y: string, gap: string) => string> = {
  seq: (x, y) =>
    `const m = await import(${x}); log("x+" + ${names("m")}); const n = await import(${y}); log("y+" + ${names("n")});`,
  all: (x, y, gap) => `${both(x, y, gap)} log("all+" + ${names("m")} + ";" + ${names("n")});`,
  late: ways.late,
  thens: ways.thens,
  requires: (x, y) => `const m = require(${x}); log("x+" + m.va); const n = require(${y}); log("y+" + n.vb);`,
  "require beside import": (x, y) =>
    `const p = keep(import(${x})); const n = require(${y}); log("y+" + n.vb); const m = await p; log("x+" + m.va);`,
  "import behind require": (x, y) =>
    `const m = require(${x}); log("x+" + m.va); const n = await import(${y}); log("y+" + n.vb + " " + (n.default && n.default.vb));`,
};

const gapOf = (turns: number) => "await null; ".repeat(turns);
const suffixOf = (turns: number) => (turns ? "k" + turns : "");

/** A ring through an awaited `import()` never ends. */
function waitsForItself(all: string[], kindOf: (from: string, to: string) => string) {
  const reaches = (from: string, goal: string, seen = new Set<string>()): boolean =>
    from === goal ||
    (!seen.has(from) &&
      (seen.add(from),
      all.some(next => next !== from && !"-D".includes(kindOf(from, next)) && reaches(next, goal, seen))));
  return all.some(from => all.some(to => from !== to && kindOf(from, to) === "A" && reaches(to, from)));
}

function* tuples(kinds: string[], length: number): Generator<string[]> {
  if (length === 0) return void (yield []);
  for (const kind of kinds) for (const rest of tuples(kinds, length - 1)) yield [kind, ...rest];
}

const pairsOf = (all: string[]) => all.flatMap(from => all.filter(to => to !== from).map(to => [from, to] as const));

/**
 * Three calls in one turn, each of a file at the head of a chain of imports, and a fourth call from the continuation of one of the three,
 * while the others may still be waited for. A file prints its name when it runs.
 */
function chainsAndContinuation(): Cell[] {
  const cells: Cell[] = [];
  const heads = ["a", "b", "c"];
  const chain = (name: string, depth: number, more: string[] = []) =>
    Object.fromEntries(
      Array.from({ length: depth + 1 }, (_, i) => [
        `${name}${i || ""}.mjs`,
        [...(i < depth ? [`${name}${i + 1}`] : []), ...(i ? [] : more)]
          .map(file => `import "./${file}.mjs";\n`)
          .join("") + `log("${name}${i || ""}");\n`,
      ]),
    );
  for (const depths of tuples(["0", "2", "5"], 3)) {
    const [a, b, c] = depths.map(Number);
    const ends = heads.flatMap((name, i) => (Number(depths[i]) ? [name + depths[i]] : []));
    for (const shares of [false, true])
      for (const from of heads)
        for (const depthOfFourth of [0, 1])
          for (const imported of ["-", ...heads, ...ends])
            for (const waits of ["then", "await"]) {
              const id = "cn" + (cells.length + 1);
              const call = (name: string) => `keep(import("./${id}/${name}.mjs"))`;
              cells.push({
                id,
                what: `chains a ${a}, b ${b}, c ${c}${shares ? ", c imports " + (b ? "b1" : "b") : ""} | behind ${from}, ${waits}: d ${depthOfFourth}${imported === "-" ? "" : ", imports " + imported}`,
                entry:
                  `const calls = { a: ${call("a")}, b: ${call("b")}, c: ${call("c")} }; await Promise.allSettled(Object.entries(calls).map(` +
                  (waits === "then"
                    ? `([name, call]) => call.then(() => { log(name + "+"); if (name === "${from}") return ${call("d")}.then(() => log("d+")); })`
                    : `async ([name, call]) => { await call; log(name + "+"); if (name === "${from}") { await ${call("d")}; log("d+"); } }`) +
                  `));`,
                files: {
                  ...chain("a", a),
                  ...chain("b", b),
                  ...chain("c", c, shares ? [b ? "b1" : "b"] : []),
                  ...chain("d", depthOfFourth, imported === "-" ? [] : [imported]),
                },
              });
            }
  }
  return cells;
}

function graphsOfESModules(table: Exclude<Table, "commonjs" | "continuations">, turns: number): Cell[] {
  const prefix = {
    two: "t",
    three: "th",
    "one-waits": "tw",
    star: "st",
    named: "nm",
    loading: "ld",
    throws: "fl",
    four: "fr",
    "three-calls": "tc",
  };
  const cells: Cell[] = [];
  const add = (all: string[], kinds: string[], waits: string, way: string, fails = "") => {
    const pairs = pairsOf(all);
    const kindOf = (from: string, to: string) => kinds[pairs.findIndex(([f, t]) => f === from && t === to)];
    if (waitsForItself(all, kindOf)) return;
    const id = prefix[table] + (cells.length + 1) + suffixOf(turns);
    const modules = new Map(all.map(name => [name, { name, file: `${name}.mjs`, edges: [] } as Module]));
    pairs.forEach(([from, to], i) => kinds[i] !== "-" && modules.get(from)!.edges.push([modules.get(to)!, kinds[i]]));
    cells.push({
      id,
      what:
        pairs.map(([from, to], i) => `${from}>${to} ${kinds[i]}`).join(", ") +
        ` | waits: ${waits || "-"}${fails ? " | fails: " + fails : ""} | ${way}`,
      entry: ways[way](`"./${id}/a.mjs"`, `"./${id}/b.mjs"`, gapOf(turns)),
      files: Object.fromEntries(
        [...modules.values()].map(module => [
          module.file,
          esModule({ ...module, waits: waits.includes(module.name), fails: fails === module.name }),
        ]),
      ),
    });
  };

  if (table === "two") {
    for (const kinds of tuples([..."-SNLRDA"], 2))
      for (const waits of ["", "a", "b", "ab"])
        for (const way of ["seq", "all", "late", "thens", "one", "twice", "tick"]) add(["a", "b"], kinds, waits, way);
    return cells;
  }

  if (table === "four") {
    // 4,000 of the 16,777,216 graphs, the same ones every time.
    const all = ["a", "b", "c", "d"];
    const pairs = pairsOf(all);
    let state = 20261101;
    const next = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0), state / 2 ** 32);
    const seen = new Set<string>();
    while (seen.size < 4000) {
      const kinds = pairs.map(() => (next() < 0.5 ? "-" : "SNA"[Math.floor(next() * 3)]));
      const key = kinds.join("");
      if (seen.has(key)) continue;
      const kindOf = (from: string, to: string) => kinds[pairs.findIndex(([f, t]) => f === from && t === to)];
      const reached = new Set(["a", "b"]);
      for (let turn = 0; turn < 3; turn++)
        for (const [from, to] of pairs) if (reached.has(from) && kindOf(from, to) !== "-") reached.add(to);
      if (reached.size < 4 || waitsForItself(all, kindOf)) continue;
      seen.add(key);
      for (const way of ["all", "late", "thens"]) add(all, kinds, "", way);
    }
    return cells;
  }

  const fourth = { star: "R", named: "X", loading: "D" }[table as string] ?? "N";
  const loads =
    table === "throws"
      ? ["all", "late", "thens", "again"]
      : table === "three-calls"
        ? ["all three", "thens three"]
        : fourth === "R" || fourth === "X"
          ? ["looks", "late", "thens"]
          : ["all", "late", "thens"];
  for (const kinds of tuples(["-", "S", fourth, "A"], 6)) {
    if (kinds[1] === "-" && kinds[3] === "-" && table !== "three-calls") continue;
    if (fourth !== "N" && !kinds.includes(fourth)) continue;
    for (const waits of table === "one-waits" ? ["a", "b", "c"] : [""])
      for (const fails of table === "throws" ? ["a", "b", "c"] : [""])
        for (const way of loads) add(["a", "b", "c"], kinds, waits, way, fails);
  }
  return cells;
}

function pairsWithCommonJS(turns: number): Cell[] {
  const kindsFrom = { m: [..."-SNLERDA"], c: [..."-QqZFD"] };
  const cells: Cell[] = [];
  for (const [typeOfA, typeOfB] of ["mc", "cm", "cc"] as const)
    for (const kindOfA of kindsFrom[typeOfA as "m" | "c"])
      for (const kindOfB of kindsFrom[typeOfB as "m" | "c"]) {
        if ((kindOfA === "E" && typeOfB === "m") || (kindOfB === "E" && typeOfA === "m")) continue;
        for (const styleOfA of typeOfA === "c" ? ["field", "whole"] : [""])
          for (const styleOfB of typeOfB === "c" ? ["field", "whole"] : [""])
            for (const waits of typeOfA === "m" ? ["", "a"] : typeOfB === "m" ? ["", "b"] : [""])
              for (const way of Object.keys(waysWithRequire)) {
                const id = "x" + (cells.length + 1) + suffixOf(turns);
                const a: Module = { name: "a", file: `a.${typeOfA}js`, edges: [], waits: waits === "a" };
                const b: Module = { name: "b", file: `b.${typeOfB}js`, edges: [], waits: waits === "b" };
                if (kindOfA !== "-") a.edges.push([b, kindOfA]);
                if (kindOfB !== "-") b.edges.push([a, kindOfB]);
                cells.push({
                  id,
                  what: `a ${styleOfA || "ES"}, b ${styleOfB || "ES"} | a>b ${kindOfA}, b>a ${kindOfB} | waits: ${waits || "-"} | ${way}`,
                  entry: waysWithRequire[way](`"./${id}/${a.file}"`, `"./${id}/${b.file}"`, gapOf(turns)),
                  files: {
                    [a.file]: typeOfA === "m" ? esModule(a) : commonJSModule(a, styleOfA === "whole"),
                    [b.file]: typeOfB === "m" ? esModule(b) : commonJSModule(b, styleOfB === "whole"),
                  },
                });
              }
      }
  return cells;
}

/**
 * `turns`: so many turns of the job queue lie between the two calls. Then only the ways that make two calls at once are given, under
 * the numbers that they have without turns.
 */
export function cellsOf(table: Table, turns = 0) {
  const cells =
    table === "commonjs"
      ? pairsWithCommonJS(turns)
      : table === "continuations"
        ? chainsAndContinuation()
        : graphsOfESModules(table, turns);
  return turns ? cells.filter(cell => /\| (all|late|thens|looks|all three|thens three)$/.test(cell.what)) : cells;
}

/**
 * The files of one program that runs the cells one after the other, the name of its entry point, and the name of a test file
 * that runs the same cells inside one test.
 */
export function programOf(
  table: Table,
  cells: Cell[],
): { entry: string; testFile: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  for (const cell of cells) for (const [name, text] of Object.entries(cell.files)) files[`${cell.id}/${name}`] = text;
  const failure = table === "commonjs" ? `(e && e.name) + " " + (e && e.code)` : `(e && e.name)`;
  const loop = `for (const [id, run] of [${cells.map(cell => `["${cell.id}", ${cell.id}]`).join(", ")}]) {
  lines = []; pending = []; later.length = 0;
  try { await run(); } catch (e) { log("threw " + ${failure}); }
  while (pending.length) await Promise.allSettled(pending.splice(0));
  for (const f of later.splice(0)) try { f(); } catch (e) { log("late threw " + (e && e.name)); }
  printed += id + " : " + lines.join(" ") + "\\n";
}
await new Promise(done => process.stdout.write(printed, done));
`;
  const entry = table === "commonjs" ? "main.cjs" : "main.mjs";
  const testFile = table === "commonjs" ? "cells.test.cjs" : "cells.test.mjs";
  const functions =
    `let lines = [], pending = [], printed = "";
globalThis.later = [];
globalThis.tag = s => s;
globalThis.look = m => log("{" + Object.keys(m).map(k => { try { return k + "=" + m[k]; } catch (e) { return k + "!" + e.name; } }) + "}");
globalThis.log = s => { lines.push(s); };
globalThis.keep = p => { p.catch(() => {}); pending.push(p); return p; };
` + cells.map(cell => `async function ${cell.id}() { ${cell.entry} }\n`).join("");
  files[entry] = functions + (table === "commonjs" ? `(async () => {\n${loop}})();\n` : loop);
  files[testFile] =
    (table === "commonjs" ? `const { test } = require("bun:test");\n` : `import { test } from "bun:test";\n`) +
    functions +
    `test("cells", async () => {\n${loop}}, 600000);\n`;
  return { entry, testFile, files };
}

/**
 * The files of one program whose entry point, a CommonJS file, begins all the cells in its own body, one behind the other: each runs up to
 * its first `await` before that body has returned. Each cell keeps a line of its own, because all are under way at once. What never settles
 * costs the program three seconds.
 */
export function programInEntryBody(table: Table, cells: Cell[]): { entry: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  for (const cell of cells)
    for (const [name, text] of Object.entries(cell.files))
      files[`${cell.id}/${name}`] = `const { log, keep, later } = toolsOf("${cell.id}");\n${text}`;
  const failure = table === "commonjs" ? `(e && e.name) + " " + (e && e.code)` : `(e && e.name)`;
  files["main.cjs"] =
    `const lines = {}, pending = {}, laters = {};
globalThis.tag = s => s;
globalThis.toolsOf = id => {
  const log = s => { (lines[id] ??= []).push(s); };
  return {
    log,
    later: (laters[id] ??= []),
    keep: p => { p.catch(() => {}); (pending[id] ??= []).push(p); return p; },
    look: m => log("{" + Object.keys(m).map(k => { try { return k + "=" + m[k]; } catch (e) { return k + "!" + e.name; } }) + "}"),
  };
};
const settled = async () => { for (;;) { const now = Object.values(pending).flatMap(list => list.splice(0)); if (!now.length) return; await Promise.allSettled(now); } };
const inTime = work => new Promise(done => { const timer = setTimeout(done, 3000); work.then(() => { clearTimeout(timer); done(); }); });
` +
    cells
      .map(
        cell =>
          `async function ${cell.id}() { const { log, keep, later, look } = toolsOf("${cell.id}"); ${cell.entry} }\n`,
      )
      .join("") +
    `const started = [];
for (const [id, run] of [${cells.map(cell => `["${cell.id}", ${cell.id}]`).join(", ")}]) started.push(run().catch(e => { toolsOf(id).log("threw " + ${failure}); }));
(async () => {
  await inTime(Promise.all(started).then(settled));
  for (const id in laters) for (const f of laters[id].splice(0)) try { f(); } catch (e) { toolsOf(id).log("late threw " + (e && e.name)); }
  await inTime(settled());
  await new Promise(done => process.stdout.write(Object.keys(lines).map(id => id + " : " + lines[id].join(" ") + "\\n").join(""), done));
})();
`;
  return { entry: "main.cjs", files };
}
