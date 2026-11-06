// Small programs of ES modules that print in which turn of a chain of jobs the promise of each `import()` settles.
//
//   the graph   the first file imports up to four modules, which import one another downward, now and then in a ring; up to two more graphs that nothing imports, which may share modules with the first
//   a module    holds nothing but an export, runs a line, or binds a name of a module that it imports
//   the calls   `import()` in the body of a module: of a module of its own graph that has not begun, that is running, that has run; of a graph that nobody has loaded; in a job of the chain; twice
//   the forms   the first file is the entry point; a further entry point that the entry point imports under a computed name; imported under its name; required; the second and the third beside a chain of the starter
import type { Random } from "./random";

export const forms = [
  "the entry point",
  "a further entry point",
  "imported by name",
  "required",
  "imported beside a chain",
  "a further entry point beside a chain",
] as const;
export type Form = (typeof forms)[number];

type Module = {
  name: string;
  imports: string[];
  kind: "holds" | "runs" | "binds";
  calls: string[];
};

const call = (from: string, target: string) =>
  `import("./${target}.mjs").then(() => console.log("${from}: ${target}"), error => console.log("${from}: ${target} rejects", error.message));\n`;

function textOf(module: Module) {
  let text = "";
  for (const imported of module.imports)
    text +=
      module.kind === "binds" ? `import { ${imported} } from "./${imported}.mjs";\n` : `import "./${imported}.mjs";\n`;
  if (module.kind === "runs") text += `console.log("${module.name} runs");\n`;
  if (module.kind === "binds") text += `console.log("${module.name} runs", ${module.imports.join(", ") || '""'});\n`;
  for (const target of module.calls) text += call(module.name, target);
  return text + `export const ${module.name} = "${module.name}";\n`;
}

export function generate(random: Random, form: Form): Program {
  const kind = () =>
    random.weighted([
      [3, "holds"],
      [3, "runs"],
      [2, "binds"],
    ] as const);
  const graph = (prefix: string, size: number, shared: string[]) => {
    const modules: Module[] = Array.from({ length: size }, (_, index) => ({
      name: prefix + index,
      imports: [],
      kind: kind(),
      calls: [],
    }));
    for (let index = 0; index < size; index++) {
      for (let below = index + 1; below < size; below++)
        if (below === index + 1 ? random.chance(0.7) : random.chance(0.3)) modules[index].imports.push(prefix + below);
      if (shared.length && random.chance(0.25)) modules[index].imports.push(random.pick(shared));
    }
    // A ring: a function would be needed to bind a name upward, so the module that closes it binds nothing.
    if (size > 2 && random.chance(0.2)) {
      const closes = modules[random.between(1, size - 1)];
      closes.kind = closes.kind === "binds" ? "runs" : closes.kind;
      closes.imports.push(prefix + "0");
    }
    return modules;
  };

  const first = graph("m", random.between(2, 5), []);
  // What the first file does not come to is a graph of its own.
  const reached = new Set(["m0"]);
  for (const module of first)
    if (reached.has(module.name)) for (const imported of module.imports) reached.add(imported);
  const names = first.map(module => module.name);
  const others = [graph("r", random.between(1, 3), names)];
  if (random.chance(0.4))
    others.push(graph("s", random.between(1, 3), [...names, ...others[0].map(module => module.name)]));
  const all = [...first, ...others.flat()];
  const roots = others.map(modules => modules[0].name);
  const target = () =>
    random.weighted([
      [5, random.pick(names)],
      [3, random.pick(roots)],
      [1, random.pick(all).name],
    ] as const);

  for (const module of all) {
    const count = random.weighted([
      [5, 0],
      [3, 1],
      [1, 2],
    ] as const);
    for (let index = 0; index < count; index++) module.calls.push(target());
  }
  if (!all.some(module => module.calls.length)) first[random.below(first.length)].calls.push(target());

  const turns = 60;
  const inJobs = new Map<number, string[]>();
  for (let index = random.between(0, 3); index > 0; index--) {
    const turn = random.weighted([
      [3, random.between(1, 6)],
      [2, random.between(7, 30)],
    ] as const);
    inJobs.set(turn, [...(inJobs.get(turn) ?? []), target()]);
  }
  const files: Record<string, string> = {};
  for (const module of all) files[module.name + ".mjs"] = textOf(module);
  let jobs = "";
  for (const [turn, targets] of inJobs)
    jobs += `  if (turn === ${turn}) {\n${targets.map(name => "    " + call("turn " + turn, name)).join("")}  }\n`;
  files["m0.mjs"] +=
    `let turns = Promise.resolve();\nfor (let turn = 1; turn <= ${turns}; turn++)\n  turns = turns.then(() => {\n  console.log(turn);\n${jobs}});\n`;

  const text = files["m0.mjs"];
  delete files["m0.mjs"];
  return startedAs(form, { file: "m0.mjs", text, files });
}

type Program = {
  file: string;
  text: string;
  files?: Record<string, string>;
  entryPoints?: string[];
};

/** A program whose first file is an ES module, in one of the forms. */
export function startedAs(form: Form, program: Program): Program {
  if (form === "the entry point") return program;
  const files = { ...program.files, [program.file]: program.text };
  const dot = program.file.lastIndexOf(".");
  const name = JSON.stringify("./" + program.file);
  const computed = `[${JSON.stringify("./" + program.file.slice(0, dot))}, ${JSON.stringify(program.file.slice(dot + 1))}].join(".")`;
  const chain =
    'let looksOn = Promise.resolve();\nfor (let turn = 1; turn <= 40; turn++) looksOn = looksOn.then(() => console.log("starter", turn));\n';
  switch (form) {
    case "a further entry point":
      return {
        file: "start.mjs",
        text: `await import(${computed});\n`,
        files,
        entryPoints: [program.file, ...(program.entryPoints ?? [])],
      };
    case "imported by name":
      return {
        ...program,
        file: "start.mjs",
        text: `await import(${name});\n`,
        files,
      };
    case "required":
      return {
        ...program,
        file: "start.cjs",
        text: `require(${name});\n`,
        files,
      };
    case "imported beside a chain":
      return {
        ...program,
        file: "start.mjs",
        text: chain + `await import(${name});\nconsole.log("the starter goes on");\n`,
        files,
      };
    case "a further entry point beside a chain":
      return {
        file: "start.mjs",
        text: chain + `await import(${computed});\nconsole.log("the starter goes on");\n`,
        files,
        entryPoints: [program.file, ...(program.entryPoints ?? [])],
      };
  }
}
