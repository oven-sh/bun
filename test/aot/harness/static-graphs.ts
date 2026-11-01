// Every graph of three modules, each an ES module or a CommonJS file, below a root that takes the first two one after the other by
// `import` or by `require()`. One load at a time: the order in which the files run, and what each sees of the others.
//
// An edge from x to y, in an ES module:  S `import "./y"`  N a name of y read while x runs  A `await import()`
// and in a CommonJS file:  Q `require()`, a member read at once  q the member read after everything  D `import()` that nobody waits for
import type { Cell } from "./cells";

const names = ["a", "b", "c"];
const pairs = names.flatMap(from => names.filter(to => to !== from).map(to => [from, to] as const));

function textOf(name: string, isES: boolean, edges: [to: string, file: string, kind: string][]) {
  const head: string[] = [];
  const body: string[] = [];
  for (const [to, file, kind] of edges) {
    if (kind === "S") head.push(`import "./${file}";`);
    if (kind === "N") head.push(`import { v${to} } from "./${file}";`);
    if (kind === "N") body.push(`log("${name}:" + v${to});`);
    if (kind === "A") body.push(`await import("./${file}");`);
    if (kind === "Q" || kind === "q") body.push(`const got${to} = require("./${file}");`);
    if (kind === "Q") body.push(`log("${name}:" + got${to}.v${to});`);
    if (kind === "q") body.push(`later.push(() => log("${name}~" + got${to}.v${to}));`);
    if (kind === "D") body.push(`keep(import("./${file}"));`);
  }
  const value = `tag("${name.toUpperCase()}")`;
  return [
    ...head,
    `log("${name}<");`,
    ...body,
    isES ? `export const v${name} = ${value};` : `exports.v${name} = ${value};`,
    `log("${name}>");`,
    "",
  ].join("\n");
}

function* tuples(choices: string[][]): Generator<string[]> {
  if (choices.length === 0) return void (yield []);
  for (const kind of choices[0]) for (const rest of tuples(choices.slice(1))) yield [kind, ...rest];
}

export const helpers = `let pending = [];
globalThis.log = log;
globalThis.later = [];
globalThis.tag = v => v;
globalThis.keep = p => { p.catch(() => {}); pending.push(p); return p; };
`;
export const call = `pending = []; later.length = 0;
  try { await run(); log("in"); } catch (e) { log("threw " + (e && e.name)); }
  while (pending.length) await Promise.allSettled(pending.splice(0));
  for (const f of later.splice(0)) try { f(); } catch (e) { log("late threw " + (e && e.name)); }`;

/** `types`: which of a, b and c are ES modules, as in "mcm". */
export function cells(types: string): Cell[] {
  const all: Cell[] = [];
  const isES = (name: string) => types[names.indexOf(name)] === "m";
  const fileOf = (name: string) => `${name}.${isES(name) ? "mjs" : "cjs"}`;
  for (const kinds of tuples(pairs.map(([from]) => (isES(from) ? ["-", "S", "N", "A"] : ["-", "Q", "q", "D"])))) {
    const kindOf = (from: string, to: string) => kinds[pairs.findIndex(([f, t]) => f === from && t === to)];
    if (kindOf("a", "c") === "-" && kindOf("b", "c") === "-") continue;
    const reaches = (from: string, goal: string, seen = new Set<string>()): boolean =>
      from === goal ||
      (!seen.has(from) &&
        (seen.add(from),
        names.some(next => next !== from && !"-D".includes(kindOf(from, next)) && reaches(next, goal, seen))));
    // A ring through an awaited import() never ends.
    if (pairs.some(([from, to]) => kindOf(from, to) === "A" && reaches(to, from))) continue;
    // The bundler refuses a require() that reaches a module with an await.
    const waits = (name: string) => names.some(to => to !== name && kindOf(name, to) === "A");
    const reachesOneThatWaits = (name: string) => names.some(other => waits(other) && reaches(name, other));
    const requiresOneThatWaits = pairs.some(([from, to]) => "Qq".includes(kindOf(from, to)) && reachesOneThatWaits(to));
    if (requiresOneThatWaits) continue;
    for (const root of ["import", "require"]) {
      if (root === "require" && (reachesOneThatWaits("a") || reachesOneThatWaits("b"))) continue;
      const id = `g${types}${all.length + 1}`;
      all.push({
        id,
        what: `${types} | ${pairs.map(([from, to], i) => `${from}>${to} ${kinds[i]}`).join(", ")} | ${root}`,
        text: `const ${id} = () => import("./${id}/${root === "import" ? "root.mjs" : "root.cjs"}");`,
        files: {
          ...Object.fromEntries(
            names.map(name => [
              fileOf(name),
              textOf(
                name,
                isES(name),
                pairs.flatMap(([from, to], i) =>
                  from === name && kinds[i] !== "-" ? [[to, fileOf(to), kinds[i]] as [string, string, string]] : [],
                ),
              ),
            ]),
          ),
          ...(root === "import"
            ? { "root.mjs": `import "./${fileOf("a")}";\nimport "./${fileOf("b")}";\nlog("root");\n` }
            : { "root.cjs": `require("./${fileOf("a")}");\nrequire("./${fileOf("b")}");\nlog("root");\n` }),
        },
      });
    }
  }
  return all;
}
