// Small programs in which several `import()` calls, started in different jobs, load graphs of ES modules that share files, and `require()` asks for one of those files meanwhile.
// The lines are printed in sorted order once every call has settled: they say what each call answered, not in which turn.
//
//   the graphs     two to four roots, each above up to two modules of its own; any of them imports shared modules, which import one another downward
//   a module       runs a line, or holds nothing but an export
//   the starts     in the body of the entry point, up to nine promise jobs later, in a tick, in a timer or an immediate; of a root, of a shared module by itself, of either a second time
//   the requires   in the body of a root or of a module below it, or in a job of the entry point: of a shared module, or of a root whose graph requires nothing
//   beside them    nothing, or a chain of jobs
//   `awaits`       one shared module awaits at its top. Whether a `require()` then throws hangs on the turn, so its line only says that the call is over
import type { Random } from "./random";

type Module = { name: string; imports: string[]; requires: string[]; runs: boolean; awaits: boolean };

const indented = (text: string) => text.replace(/^(?=.)/gm, "  ");

export function generate(random: Random, options: { awaits?: boolean } = {}) {
  const requireText = (from: string, target: string) =>
    options.awaits
      ? `try {\n  require("./${target}.mjs");\n} catch {}\nlines.push("${from} has asked for ${target}");\n`
      : `try {\n  lines.push("${from} requires ${target}: " + Object.keys(require("./${target}.mjs")));\n} catch (error) {\n  lines.push("${from} requires ${target}: " + error.name);\n}\n`;
  const importText = (target: string, call: number) =>
    `import("./${target}.mjs").then(\n  () => settle("${target} is imported, call ${call}"),\n  error => settle("${target} is rejected, call ${call}: " + error.name),\n);\n`;
  const textOf = (module: Module) => {
    let text = module.imports.map(imported => `import "./${imported}.mjs";\n`).join("");
    if (module.runs) text += `lines.push("${module.name} runs");\n`;
    if (module.awaits) text += `await 0;\nlines.push("${module.name} goes on");\n`;
    for (const target of module.requires) text += requireText(module.name, target);
    return text + `export const ${module.name} = "${module.name}";\n`;
  };
  const module = (name: string): Module => ({
    name,
    imports: [],
    requires: [],
    runs: random.chance(0.75),
    awaits: false,
  });

  const shared = Array.from({ length: random.between(1, 4) }, (_, index) => module("s" + index));
  shared.forEach((above, index) => {
    for (const below of shared.slice(index + 1)) if (random.chance(0.35)) above.imports.push(below.name);
  });
  if (options.awaits) random.pick(shared).awaits = true;
  const sharedNames = shared.map(one => one.name);

  const graphs = Array.from({ length: random.between(2, 4) }, (_, number) => {
    const own = [module("r" + number)];
    const levels = random.weighted([
      [3, 0],
      [3, 1],
      [2, 2],
    ] as const);
    while (own.length <= levels) {
      const below = module(`r${number}below${own.length}`);
      own[own.length - 1].imports.push(below.name);
      own.push(below);
    }
    for (const one of own) for (const name of sharedNames) if (random.chance(0.3)) one.imports.push(name);
    return own;
  });
  // The first graph requires, and what is required requires nothing: no two modules ask for each other.
  const asking = graphs.filter((_, number) => number === 0 || random.chance(0.7));
  const quietRoots = graphs.filter(own => !asking.includes(own)).map(own => own[0].name);
  const required = () =>
    random.weighted([
      [5, random.pick(sharedNames)],
      [quietRoots.length ? 1 : 0, random.pick(quietRoots.length ? quietRoots : sharedNames)],
    ] as const);
  for (const own of asking) for (const one of own) if (random.chance(0.45)) one.requires.push(required());
  if (!asking.flat().some(one => one.requires.length)) asking[0][0].requires.push(required());

  const later = random.pick(["setTimeout", "setImmediate"] as const);
  const started = (what: string) => {
    const time = random.weighted([
      [3, "now"],
      [8, random.between(1, 9)],
      [1, "process.nextTick"],
      [1, later],
    ] as const);
    if (time === "now") return what;
    return `${typeof time === "number" ? `after(${time}, ` : `${time}(`}() => {\n${indented(what)}});\n`;
  };

  const targets = graphs.map(own => own[0].name);
  for (let count = random.between(1, 2); count > 0; count--) targets.push(random.pick(sharedNames));
  if (random.chance(0.4)) targets.push(random.pick(targets));
  const requiredInJob = random.chance(0.35) ? required() : undefined;

  let text =
    `globalThis.lines = [];\n` +
    `let unsettled = ${targets.length + Number(!!requiredInJob)};\n` +
    `function settle(line) {\n  if (line) lines.push(line);\n  if (--unsettled === 0) console.log(lines.sort().join("\\n"));\n}\n` +
    `function after(jobs, start) {\n  if (jobs === 0) start();\n  else Promise.resolve().then(() => after(jobs - 1, start));\n}\n`;
  if (random.chance(0.5))
    text += "let chain = Promise.resolve();\nfor (let turn = 0; turn < 50; turn++) chain = chain.then(() => {});\n";
  const calls = new Map<string, number>();
  // The first call comes first: the others meet a load that is under way.
  for (const target of [targets[0], ...random.shuffled(targets.slice(1))]) {
    calls.set(target, (calls.get(target) ?? 0) + 1);
    text += calls.size === 1 ? importText(target, 1) : started(importText(target, calls.get(target)!));
  }
  if (requiredInJob) text += started(requireText("the entry point", requiredInJob) + "settle();\n");

  const files: Record<string, string> = {};
  const answers: Record<string, string> = {};
  for (const one of [...shared, ...graphs.flat()]) {
    files[one.name + ".mjs"] = textOf(one);
    for (const target of one.requires) answers[`${one.name} requires ${target}: `] = target;
  }
  if (requiredInJob) answers[`the entry point requires ${requiredInJob}: `] = requiredInJob;
  /** `answers`: how each line about a `require()` begins, and how it ends where nothing awaits. */
  return { file: "main.mjs", text, files, answers };
}
