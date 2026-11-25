// Every graph of three ES modules that has an `import defer` in it, and the ways an entry point comes to the first of them.
// A cell is one graph. It prints one line: the order in which its modules run and its promises settle, and what they see of each other.
//
// An edge from x to y:
//   N a name of y read while x runs        D `import()` that nobody waits for: the line says how it ends
//   G `import defer`, read while x runs    H `import defer`, read after everything
//
// A program holds many cells. Each keeps its own line, because all cells are under way at once.

export const ways = {
  /** A CommonJS entry point requires the first module while its own body runs. */
  "body of a CommonJS entry": "b",
  /** The same entry point requires it in a job, when its body has returned. */
  "job of a CommonJS entry": "j",
  /** An ES entry point requires it by `createRequire()`. */
  "createRequire in an ES entry": "r",
} as const;
export type Way = keyof typeof ways;
export type Cell = { id: string; what: string; files: Record<string, string> };

const all = ["a", "b", "c"];
const pairs = all.flatMap(from => all.filter(to => to !== from).map(to => [from, to] as const));

function* tuples(kinds: string[], length: number): Generator<string[]> {
  if (length === 0) return void (yield []);
  for (const kind of kinds) for (const rest of tuples(kinds, length - 1)) yield [kind, ...rest];
}

function moduleOf(id: string, name: string, edges: [to: string, kind: string][]) {
  const head: string[] = [];
  const body: string[] = [];
  for (const [to, kind] of edges) {
    if (kind === "N") head.push(`import { v${to} } from "./${to}.mjs";`);
    if (kind === "N") body.push(`log("${name}:" + v${to});`);
    if (kind === "G" || kind === "H") head.push(`import defer * as whole${to} from "./${to}.mjs";`);
    if (kind === "G") body.push(`log("${name}:" + whole${to}.v${to});`);
    if (kind === "H") body.push(`later.push(() => log("${name}~" + whole${to}.v${to}));`);
    if (kind === "D") body.push(`keep("${name}${to}", import("./${to}.mjs"));`);
  }
  return [
    ...head,
    `const { log, keep, later } = toolsOf("${id}");`,
    `log("${name}<");`,
    ...body,
    `export const v${name} = tag("${name.toUpperCase()}");`,
    `log("${name}>");`,
    "",
  ].join("\n");
}

/** `deferred`: the kinds of `import defer` that the graphs may hold; each graph holds at least one. */
export function cellsOf(way: Way, deferred: string[] = ["G"]): Cell[] {
  const cells: Cell[] = [];
  let number = 0;
  for (const kinds of tuples(["-", "N", "D", ...deferred], pairs.length)) {
    number++;
    if (!kinds.some(kind => deferred.includes(kind))) continue;
    const reached = new Set(["a"]);
    all.forEach(() => pairs.forEach(([from, to], i) => reached.has(from) && kinds[i] !== "-" && reached.add(to)));
    if (pairs.some(([from], i) => kinds[i] !== "-" && !reached.has(from))) continue;
    const id = "g" + ways[way] + deferred.join("").toLowerCase() + number;
    cells.push({
      id,
      what: pairs.map(([from, to], i) => `${from}>${to} ${kinds[i]}`).join(", ") + ` | ${way}`,
      files: Object.fromEntries(
        [...reached].map(name => [
          `${name}.mjs`,
          moduleOf(
            id,
            name,
            pairs.flatMap(([from, to], i) =>
              from === name && kinds[i] !== "-" ? [[to, kinds[i]] as [string, string]] : [],
            ),
          ),
        ]),
      ),
    });
  }
  return cells;
}

const tools = `const lines = {}, pending = [], laters = {};
globalThis.tag = s => s;
globalThis.toolsOf = id => ({
  log: s => { (lines[id] ??= []).push(s); },
  keep: (name, p) => { pending.push(p.then(() => { lines[id].push(name + "+"); }, e => { lines[id].push(name + "!" + (e && e.name)); })); },
  later: (laters[id] ??= []),
});
const settled = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const inTime = () => new Promise(done => { const timer = setTimeout(done, 3000); settled().then(() => { clearTimeout(timer); done(); }); });
globalThis.run = (id, load) => { try { load(); toolsOf(id).log("+"); } catch (e) { toolsOf(id).log("threw " + (e && e.name)); } };
globalThis.finish = async ids => {
  await inTime();
  for (const id of ids) for (const f of toolsOf(id).later.splice(0)) try { f(); } catch (e) { toolsOf(id).log("late threw " + (e && e.name)); }
  await inTime();
  await new Promise(done => process.stdout.write(ids.map(id => id + " : " + (lines[id] ?? []).join(" ") + "\\n").join(""), done));
};
`;

/** The files of one program that runs the cells, and the name of its entry point. */
export function programOf(way: Way, cells: Cell[]): { entry: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  for (const cell of cells) for (const [name, text] of Object.entries(cell.files)) files[`${cell.id}/${name}`] = text;
  const ids = `[${cells.map(cell => `"${cell.id}"`).join(", ")}]`;
  const requires = cells.map(cell => `run("${cell.id}", () => require("./${cell.id}/a.mjs"));\n`).join("");
  if (way === "body of a CommonJS entry")
    return { entry: "main.cjs", files: { ...files, "main.cjs": `${tools}${requires}finish(${ids});\n` } };
  if (way === "job of a CommonJS entry")
    return {
      entry: "main.cjs",
      files: { ...files, "main.cjs": `${tools}Promise.resolve().then(() => {\n${requires}finish(${ids});\n});\n` },
    };
  files["tools.mjs"] = tools;
  files["main.mjs"] =
    `import "./tools.mjs";\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n${requires}await finish(${ids});\n`;
  return { entry: "main.mjs", files };
}
