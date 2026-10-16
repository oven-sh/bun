// Random graphs of ES modules: 3 to 12 modules, all reached from m0. An import may go to any module: back (a cycle), to the module
// itself, twice to the same one. A module has no await, or one to three `await null`, or an await that stands in the text and never
// runs. It may throw as its first act or as its last, behind its awaits: an Error, a number or undefined.
//
// Every line that a module prints is stamped with the turn of the microtask queue in which it is printed, so the order in which
// modules are evaluated and the turn in which each goes on behind an await are both compared. top.js has no await and imports m0:
// it runs in the job in which the evaluation of m0 completes. main.js imports top.js dynamically, then, when all is quiet, one more
// module of the graph, then top.js again, and prints at the end what each import came to: how many turns `import()` itself takes is
// not part of the language.
//
// The graph is chosen by `seed / 3` and the order in which each module lists its imports by the seed, so three seeds in a row are
// one graph in three orders.
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number) => Math.floor(next() * n);
  return {
    next,
    below,
    choice: <T>(list: readonly T[]): T => list[below(list.length)],
    shuffle<T>(list: T[]) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = below(i + 1);
        [list[i], list[j]] = [list[j], list[i]];
      }
    },
  };
}

const log = `let tick = 0, epoch = 0, started = false;
const step = mine => { if (mine !== epoch) return; tick++; if (tick < 150) Promise.resolve().then(() => step(mine)); };
export const say = what => { if (!started) { started = true; const mine = epoch; Promise.resolve().then(() => step(mine)); } console.log(tick + " " + what); };
export const quiet = () => { let p = Promise.resolve(); for (let i = 0; i < 200; i++) p = p.then(() => {}); return p.then(() => { epoch++; tick = 0; started = false; }); };
export const show = e => e instanceof Error ? e.message : String(e);
`;

export function program(seed: number): { file: string; text: string; files: Record<string, string> } {
  const graph = random(Math.floor(seed / 3) * 2 + 1);
  const order = random(seed * 2);
  const count = 3 + graph.below(10);
  const imports: number[][] = Array.from({ length: count }, () => []);
  for (let i = 1; i < count; i++) imports[graph.below(i)].push(i);
  const more = graph.choice([
    [0, 0, 0, 0, 1],
    [0, 0, 0, 1, 1, 2],
    [0, 0, 1, 1, 2, 3],
  ]);
  for (let i = 0; i < count; i++) for (let k = graph.choice(more); k > 0; k--) imports[i].push(graph.below(count));
  const shareThatAwait = graph.choice([0.2, 0.5, 0.8]);
  const shareThatThrow = graph.choice([0, 0, 0.08, 0.2]);

  const files: Record<string, string> = { "log.js": log, "top.js": 'import { say } from "./log.js";\nimport "./m0.js";\nsay("top runs");\n' };
  for (let i = 0; i < count; i++) {
    const awaits = graph.next() < shareThatAwait ? graph.choice([0, 1, 1, 2, 3]) : undefined;
    const throws = graph.next() < shareThatThrow ? graph.choice(["first", "last", "last"]) : undefined;
    const error = `new Error("m${i}")`;
    const thrown = graph.choice([error, error, error, error, error, error, String(100 + i), "undefined"]);
    const listed = [...imports[i]];
    order.shuffle(listed);
    const lines = ['import { say } from "./log.js";', ...listed.map(to => `import "./m${to}.js";`), `say("m${i} a");`];
    if (throws === "first") lines.push(`if (!globalThis.never) throw ${thrown};`);
    if (awaits === 0) lines.push("if (globalThis.never) await null;");
    for (let k = 1; k <= (awaits ?? 0); k++) lines.push(`await null; say("m${i} b${k}");`);
    if (throws === "last") lines.push(`if (!globalThis.never) throw ${thrown};`);
    lines.push(`say("m${i} z");`);
    files[`m${i}.js`] = lines.join("\n") + "\n";
  }
  const second = graph.below(count);
  const text = `import { quiet, show } from "./log.js";
const outcomes = [];
const seen = (what, p) => p.then(() => outcomes.push(what + " resolves"), e => outcomes.push(what + " rejects " + show(e))).then(quiet);
seen("import(top)", import("./top.js")).then(() => seen("import(m${second})", import("./m${second}.js"))).then(() => seen("import(top) again", import("./top.js"))).then(() => console.log(outcomes.join("\\n")));
`;
  return { file: "main.js", text, files };
}
