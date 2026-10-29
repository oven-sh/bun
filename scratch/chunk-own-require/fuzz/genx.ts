// Scratch extension of test/bundler/splitting-fuzz.ts's generator (review probe; not part of the repo).
// The main random stream and its draw order are the repo generator's, so a seed gives the repo's graph.
// Added, each from a stream of its own:
//   always:       every module exports `req<i>()`, which calls the runtime's `__require` (a computed request);
//                 static importers and every `require()` site read it.
//   opts.chains:  `chain<i>()` calls a statically imported module's `req<j>()`; `via<i>_req<j>` re-exports one.
//   opts.back:    a module `require()`s one of its static ancestors at its top level (a require cycle).
//   opts.tla:     a module does `await import()` at its top level.
//   opts.hook:    a module calls a function of a package outside the bundle that `require()`s the running entry.
//   opts.dirs:    non-entry modules are spread over source directories (for `[dir]` in a chunk name).
import { posix } from "node:path";

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Opts = { chains?: boolean; back?: boolean; tla?: boolean; hook?: boolean; dirs?: boolean };
export type Tree = "direct" | "direct-flat" | "stub-flat" | "stub-2dirs";
export type Graph = { files: Record<string, string>; entries: string[]; n: number; other: number };

export function generateGraph(seed: number, tree: Tree, opts: Opts = {}, staticStub = false): Graph {
  const rnd = rng(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const chance = (p: number) => rnd() < p;
  const n = 5 + int(10);
  const twoEntries = chance(0.25);

  const staticImports: number[][] = [];
  for (let i = 0; i < n; i++) {
    const imports = new Set<number>();
    const count = i === 0 ? 1 + int(3) : int(3);
    for (let k = 0; k < count; k++) {
      const j = chance(0.15) ? int(n) : Math.min(n - 1, i + 1 + int(n - i));
      if (j !== i && j !== 0) imports.add(j);
    }
    staticImports.push([...imports]);
  }
  const awaits = new Set<number>();
  for (let i = 1; i < n; i++) if (chance(0.08)) awaits.add(i);

  // extra: top-level `await import()`
  const xTla = rng(seed ^ 0x2545f491);
  const tla = new Map<number, number>();
  if (opts.tla) {
    for (let i = 1; i < n; i++) {
      if (xTla() < 0.12) {
        const t = 1 + Math.floor(xTla() * (n - 1));
        if (t !== i) {
          tla.set(i, t);
          awaits.add(i);
        }
      }
    }
  }

  const reachesAwait = new Set<number>(awaits);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (!reachesAwait.has(i) && staticImports[i].some(j => reachesAwait.has(j))) {
        reachesAwait.add(i);
        changed = true;
      }
    }
  }
  const requirable = [...Array(n).keys()].filter(i => i !== 0 && !reachesAwait.has(i));
  const pure = new Set<number>();
  for (let i = 1; i < n; i++) if (!awaits.has(i) && chance(0.25)) pure.add(i);

  const loaders: { file: number; target: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (requirable.length && chance(0.45)) {
      const target = requirable[int(requirable.length)];
      if (target !== i) loaders.push({ file: i, target });
    }
  }
  for (const { target } of [...loaders]) {
    if (chance(0.3)) {
      const file = int(n);
      if (file !== target && !loaders.some(l => l.file === file && l.target === target)) loaders.push({ file, target });
    }
  }

  const later = rng(seed ^ 0x5bd1e995);

  // extra: chains
  const xChain = rng(seed ^ 0x7f4a7c15);
  const chainOf = new Map<number, number>();
  if (opts.chains) {
    for (let i = 0; i < n; i++) {
      if (staticImports[i].length && xChain() < 0.6) {
        chainOf.set(i, staticImports[i][Math.floor(xChain() * staticImports[i].length)]);
      }
    }
  }
  // extra: a module requires one of its static ancestors at its top level
  const xBack = rng(seed ^ 0x3c6ef372);
  const reaches = (from: number, to: number) => {
    const seen = new Set<number>([from]);
    const stack = [from];
    while (stack.length) {
      for (const j of staticImports[stack.pop()!]) {
        if (j === to) return true;
        if (!seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    return false;
  };
  const backOf = new Map<number, number>();
  if (opts.back) {
    for (let i = 1; i < n; i++) {
      if (xBack() < 0.25) {
        const ancestors = requirable.filter(t => t !== i && reaches(t, i));
        if (ancestors.length) backOf.set(i, ancestors[Math.floor(xBack() * ancestors.length)]);
      }
    }
  }
  const xHook = rng(seed ^ 0x1b873593);

  // Specifiers are written as §f3§ / §log§ and resolved once every module has a directory. §sites:t§ expands to the
  // reads that a `require()` of module t can make, known once every module is generated.
  const viaOf = new Map<number, number>();
  const nsOf = new Map<number, number>();
  const sources: string[] = [];
  for (let i = 0; i < n; i++) {
    let src = `import { note, read, attempt, later, id } from "§log§";\n`;
    const importsItself = later() < 0.1 && !pure.has(i);
    if (importsItself) src += `import * as self${i} from "§f${i}§";\n`;
    const usesHook = opts.hook ? xHook() < 0.12 && !pure.has(i) : false;
    if (usesHook) src += `import { poke } from "fuzz-hook";\n`;
    const uses: string[] = [];
    let base: number | undefined;
    for (const j of staticImports[i]) {
      const names = [`get${j}`, `C${j}`, `req${j}`];
      if (chainOf.has(j)) names.push(`chain${j}`);
      for (const l of loaders) if (l.file === j) names.push(`load${l.file}_${l.target}`);
      src += `import { ${names.join(", ")} } from "§f${j}§";\n`;
      if (base === undefined && chance(0.4)) base = j;
    }
    if (staticImports[i].length && chance(0.2)) {
      const j = staticImports[i][int(staticImports[i].length)];
      if (chance(0.5)) {
        src += `export { get${j} as via${i}_get${j} } from "§f${j}§";\n`;
        if (opts.chains) {
          src += `export { req${j} as via${i}_req${j} } from "§f${j}§";\n`;
          viaOf.set(i, j);
        }
      } else {
        src += `export * as ns${i}_${j} from "§f${j}§";\n`;
        if (opts.chains) nsOf.set(i, j);
      }
    }
    const isPure = pure.has(i);
    if (!isPure) src += `note("f${i}");\n`;
    if (awaits.has(i)) src += `await null;\n`;
    if (tla.has(i)) {
      const t = tla.get(i)!;
      src += `{ const m: any = await import("§f${t}§").catch(() => undefined); read("f${i}^import${t}", () => m.req${t}());§tsites:${i}:${t}§ }\n`;
    }
    src += `export const val${i} = "v${i}";\n`;
    src += `export function get${i}() { return val${i}; }\n`;
    src += `export function req${i}() { return typeof require(id("node:os")).EOL; }\n`;
    if (chainOf.has(i)) src += `export function chain${i}() { return req${chainOf.get(i)}(); }\n`;
    src +=
      base === undefined || isPure
        ? `export class C${i} { tag() { return "c${i}"; } }\n`
        : `export const C${i} = attempt("f${i}:class", () => class extends C${base} { tag() { return "c${i}<" + super.tag(); } });\n`;
    for (const l of loaders) {
      if (l.file === i)
        src += `export function load${i}_${l.target}() { read("load${i}_${l.target}:req", () => require("§f${l.target}§").req${l.target}());§sites:load${i}_${l.target}:${l.target}§ return require("§f${l.target}§").get${l.target}(); }\n`;
    }
    if (!isPure) {
      if (importsItself) uses.push(`read("f${i}<self", () => typeof self${i}.get${i})`);
      for (const j of staticImports[i]) {
        uses.push(`read("f${i}<req${j}", () => req${j}())`);
        if (chainOf.has(j)) uses.push(`read("f${i}<chain${j}", () => chain${j}())`);
        if (chance(0.5)) uses.push(`read("f${i}<f${j}", () => get${j}())`);
        if (chance(0.2)) uses.push(`read("f${i}<C${j}", () => new C${j}().tag())`);
        for (const l of loaders) {
          if (l.file === j && chance(0.5))
            uses.push(`read("f${i}<load${l.file}_${l.target}", () => load${l.file}_${l.target}())`);
        }
      }
      for (const l of loaders) {
        if (l.file === i && chance(0.35)) uses.push(`read("f${i}<load${i}_${l.target}", () => load${i}_${l.target}())`);
      }
      if (requirable.length && chance(0.25)) {
        const t = requirable[int(requirable.length)];
        if (t !== i) {
          uses.push(`read("f${i}<require${t}", () => require("§f${t}§").get${t}())`);
          uses.push(`read("f${i}<requireq${t}", () => require("§f${t}§").req${t}())§sites:f${i}<require${t}:${t}§`);
        }
      }
      if (backOf.has(i)) {
        const t = backOf.get(i)!;
        uses.push(`read("f${i}<back${t}", () => require("§f${t}§").req${t}())§sites:f${i}<back${t}:${t}§`);
      }
      if (usesHook) uses.push(`read("f${i}<poke", () => poke())`);
      for (const use of uses) src += use + ";\n";
      if (chance(0.2)) {
        const t = 1 + int(n - 1);
        if (t !== i)
          src += `later(() => import("§f${t}§").then(m => read("f${i}~import${t}", () => m.get${t}())));\n`;
      }
      src += `note("f${i}:done");\n`;
    }
    sources.push(src);
  }
  const other = twoEntries ? 1 + int(n - 1) : 1;

  // directories
  const dirOf: string[] = Array(n).fill("");
  const xDir = rng(seed ^ 0x68bc21eb);
  if (opts.dirs) for (let i = 0; i < n; i++) dirOf[i] = ["", "", "c", "d"][Math.floor(xDir() * 4)];
  if (tree === "direct") {
    dirOf[0] = "a";
    dirOf[other] = "b";
  }
  const pathOf = (i: number) => (dirOf[i] ? dirOf[i] + "/" : "") + `f${i}.ts`;
  const rel = (fromDir: string, to: string) => {
    const r = posix.relative(fromDir || ".", to);
    return r.startsWith(".") ? r : "./" + r;
  };
  const expand = (src: string, fromDir: string) =>
    src
      .replace(/§sites:([^:§]+):(\d+)§/g, (_, what: string, tt: string) => {
        const t = Number(tt);
        let out = "";
        const more = (suffix: string, call: string) =>
          (out += `; read("${what}:${suffix}", () => require("§f${t}§").${call})`);
        if (chainOf.has(t)) more("chain", `chain${t}()`);
        if (viaOf.has(t)) more("via", `via${t}_req${viaOf.get(t)}()`);
        if (nsOf.has(t)) more("ns", `ns${t}_${nsOf.get(t)}.req${nsOf.get(t)}()`);
        return what.startsWith("load") ? out.replace(/^; /, " ") + (out ? ";" : "") : out;
      })
      .replace(/§tsites:(\d+):(\d+)§/g, (_, ii: string, tt: string) => {
        const t = Number(tt);
        return chainOf.has(t) ? ` read("f${ii}^chain${t}", () => m.chain${t}());` : "";
      })
      .replace(/§f(\d+)§/g, (_, j: string) => rel(fromDir, pathOf(Number(j))))
      .replace(/§log§/g, rel(fromDir, "log.ts"));

  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) files[pathOf(i)] = expand(sources[i], dirOf[i]);
  files["log.ts"] = `
const lines: string[] = [];
const thunks: (() => Promise<unknown>)[] = [];
export const id = (x: string) => x;
export function note(what: string) { lines.push(what); }
export function read(what: string, get: () => unknown) {
  let value: unknown;
  try { value = get(); } catch { value = undefined; }
  lines.push(what + "=" + (value === undefined ? "!" : String(value)));
  return value;
}
export function attempt<T>(what: string, make: () => T): T | undefined {
  try { return make(); } catch { lines.push(what + "=!"); return undefined; }
}
export function later(thunk: () => Promise<unknown>) { thunks.push(thunk); }
let finished = false;
process.on("beforeExit", async () => {
  if (finished) return;
  finished = true;
  for (let i = 0; i < thunks.length; i++) { note("later" + i); try { await thunks[i](); } catch { lines.push("later" + i + "=!"); } }
  console.log(lines.join("\\n"));
});
`;
  let entries: string[];
  const stub = (dir: string, target: number) =>
    expand(`import "§log§";\n` + (staticStub ? `import "§f${target}§";\n` : `await import("§f${target}§");\n`), dir);
  if (tree === "direct" || tree === "direct-flat") {
    entries = [pathOf(0), pathOf(other)];
  } else if (tree === "stub-2dirs") {
    files["a/entry.ts"] = stub("a", 0);
    files["b/entry2.ts"] = stub("b", other);
    entries = ["a/entry.ts", "b/entry2.ts"];
  } else {
    files["entry.ts"] = stub("", 0);
    entries = ["entry.ts"];
    if (twoEntries) {
      files["entry2.ts"] = stub("", other);
      entries.push("entry2.ts");
    }
  }
  return { files, entries, n, other };
}
