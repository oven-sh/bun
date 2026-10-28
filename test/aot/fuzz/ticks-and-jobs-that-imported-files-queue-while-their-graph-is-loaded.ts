// Small programs of three to six files. An ES module imports CommonJS files and ES modules, and some of them queue something while the graph is loaded. Every file and everything
// that was queued says when it runs.
//
//   queued         a tick, a promise job, `queueMicrotask`, `setImmediate`, a timer; a tick that queues a tick, a job or both; a job that queues a tick; several in one file
//   by             the first, a middle or the last imported CommonJS file, an imported ES module, the importer itself; `process.nextTick` is only named, or held in a variable
//   the graph      flat, below an ES module between, or both; the entry point's own, or loaded by `import()` once the entry point has run
//   before it      nothing, or a file in front has used `process.nextTick` already
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const queues = (who: string): string =>
    random.weighted([
      [6, `process.nextTick(() => console.log("tick of ${who}"));`],
      [3, `Promise.resolve().then(() => console.log("job of ${who}"));`],
      [1, `queueMicrotask(() => console.log("microtask of ${who}"));`],
      [1, `setImmediate(() => console.log("immediate of ${who}"));`],
      [1, `setTimeout(() => console.log("timer of ${who}"), 0);`],
      [
        2,
        `process.nextTick(() => {\n  console.log("tick of ${who}");\n  process.nextTick(() => console.log("tick of the tick of ${who}"));\n});`,
      ],
      [
        2,
        `process.nextTick(() => {\n  console.log("tick of ${who}");\n  Promise.resolve().then(() => console.log("job of the tick of ${who}"));\n});`,
      ],
      [
        1,
        `Promise.resolve().then(() => {\n  console.log("job of ${who}");\n  process.nextTick(() => console.log("tick of the job of ${who}"));\n});`,
      ],
      [1, `console.log("${who} names it", typeof process.nextTick);`],
      [1, `const later_${who} = process.nextTick;\nlater_${who}(() => console.log("tick of ${who}"));`],
      [
        1,
        `process.nextTick((one, two) => console.log("tick of ${who}", one, two), 1, 2);\nprocess.nextTick(() => console.log("second tick of ${who}"));`,
      ],
    ]);
  const body = (who: string, chance: number) => {
    const lines = [`console.log("${who} runs");`];
    for (
      let left = random.chance(chance)
        ? random.weighted([
            [5, 1],
            [2, 2],
            [1, 3],
          ])
        : 0;
      left > 0;
      left--
    )
      lines.push(queues(who));
    return lines.join("\n") + "\n";
  };

  const count = random.between(2, 4);
  const names = ["first", "second", "third", "fourth"].slice(0, count);
  // One file queues for certain. Most of the others queue nothing.
  const certain = random.below(count);
  const imports = names.map((name, at) => {
    const extension = random.chance(0.8) ? "cjs" : "mjs";
    files[`${name}.${extension}`] = body(name, at === certain ? 1 : 0.25);
    return `import "./${name}.${extension}";\n`;
  });

  const inFront = random.chance(0.25);
  if (inFront) files["zero.cjs"] = `console.log("zero runs");\nprocess.nextTick(() => console.log("tick of zero"));\n`;
  const front = inFront ? `import "./zero.cjs";\n` : "";

  const shape = random.weighted([
    [4, "flat"],
    [2, "below"],
    [2, "both"],
  ]);
  let graph: string;
  if (shape === "flat") graph = imports.join("");
  else {
    const cut = shape === "below" ? 0 : random.between(1, count - 1);
    files["between.mjs"] = imports.slice(cut).join("") + body("between", 0.3);
    graph = imports.slice(0, cut).join("") + `import "./between.mjs";\n`;
  }

  if (random.chance(0.7)) return { file: "main.mjs", text: front + graph + body("main", 0.4), files };
  files["root.mjs"] = graph + body("root", 0.3);
  return {
    file: "main.mjs",
    text: `${front}${body("main", 0.3)}await import("./root.mjs");\nconsole.log("main ends");\n`,
    files,
  };
}
