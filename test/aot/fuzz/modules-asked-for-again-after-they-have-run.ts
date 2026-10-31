// Small programs of four or five files in which the first file loads the others with `import()`, a few steps in a row, with pauses in between. A module runs once; whoever asks for it again, by whatever
// road and however much later, gets the same namespace object with the values of that moment; a module that threw rejects every later `import()` with the same error. Every line is printed at once.
//
//   the files   one with a variable that a function of it counts up; one that imports it and exports it again, and may wait at its top; one that imports both; one that throws; two that import
//               each other
//   the steps   `import()` of each, again, two at once, in a function that is called twice; `require` of a module that has run; the counting function; a read
//               through each namespace
//   the pauses  none, a job, a timer, `setImmediate`, a collection
//   the first   a module, or a CommonJS file with an async function
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const waits = random.chance(0.3);
  const files: Record<string, string> = {
    "dep.mjs": 'console.log("dep runs");\nexport let count = 0;\nexport function bump() {\ncount++;\n}\n',
    "m.mjs": `import { count, bump } from "./dep.mjs";\nconsole.log("m runs", count);\n${waits ? random.pick(["await null;\n", "await new Promise(resolve => setTimeout(resolve, 1));\n"]) + 'console.log("m goes on", count);\n' : ""}export { count, bump };\nexport const name = "m";\n`,
    "other.mjs":
      'import { count } from "./dep.mjs";\nimport * as m from "./m.mjs";\nconsole.log("other runs", count, m.name);\nexport const seen = () => count + " " + m.count;\n',
    "bad.mjs": 'import { bump } from "./dep.mjs";\nconsole.log("bad runs");\nbump();\nthrow new Error("bad");\n',
    "ring-a.mjs":
      'import { fromB } from "./ring-b.mjs";\nconsole.log("ring a runs");\nexport function fromA() {\nreturn "a";\n}\nexport const both = () => fromA() + fromB();\n',
    "ring-b.mjs":
      'import { fromA } from "./ring-a.mjs";\nconsole.log("ring b runs", fromA());\nexport function fromB() {\nreturn "b";\n}\n',
  };
  const pause = () =>
    random.pick([
      "",
      "",
      "await null;",
      "await new Promise(resolve => setTimeout(resolve, 1));",
      "await new Promise(resolve => setTimeout(resolve, 1));",
      "await new Promise(resolve => setImmediate(resolve));",
      "Bun.gc(true);",
      "await new Promise(resolve => setTimeout(resolve, 1));\nBun.gc(true);",
    ]);
  const steps: [number, string][] = [
    [
      6,
      'held.push(await import("./m.mjs"));\nconsole.log("m", held.length, held.at(-1) === held[0], held.at(-1).count, held.at(-1).name);',
    ],
    [3, 'held[0]?.bump();\nconsole.log("bumped", held[0]?.count);'],
    [3, '{\nconst other = await import("./other.mjs");\nconsole.log("other", other.seen());\n}'],
    [
      3,
      'try {\nawait import("./bad.mjs");\nconsole.log("bad did not throw");\n} catch (error) {\nerrors.push(error);\nconsole.log("bad", error.message, errors[0] === error);\n}',
    ],
    [
      2,
      '{\nconst [one, two] = await Promise.all([import("./m.mjs"), import("./other.mjs")]);\nconsole.log("at once", one.name, two.seen());\n}',
    ],
    [
      2,
      '{\nconst [one, two] = await Promise.all([import("./m.mjs"), import("./m.mjs")]);\nconsole.log("twice at once", one === two, one.count);\n}',
    ],
    [3, '{\nconst dep = await import("./dep.mjs");\ndep.bump();\nconsole.log("dep", dep.count, held[0]?.count);\n}'],
    [2, '{\nconst ring = await import("./ring-a.mjs");\nconsole.log("ring", ring.both());\n}'],
    [1, '{\nconst ring = await import("./ring-b.mjs");\nconsole.log("ring", ring.fromB());\n}'],
    [2, 'console.log("loaded", await load(), await load());'],
    [
      waits ? 0 : 2,
      '{\nconst required = require("./m.mjs");\nconsole.log("required", required === held[0], required.name, required.count);\n}',
    ],
    [2, '{\nconst required = require("./dep.mjs");\nrequired.bump();\nconsole.log("required dep", required.count);\n}'],
    [
      1,
      'console.log("keys", Object.keys(await import("./m.mjs")).join(), Object.keys(await import("./dep.mjs")).join());',
    ],
  ];
  const drawn: string[] = [];
  const count = random.between(2, 6);
  for (let i = 0; i < count; i++) {
    drawn.push(random.weighted(steps));
    const rest = pause();
    if (rest) drawn.push(rest);
  }
  const body = drawn.join("\n");
  const load = body.includes("await load()")
    ? 'async function load() {\nreturn (await import("./m.mjs")).count;\n}\n'
    : "";
  const used = Object.fromEntries(
    Object.entries(files).filter(
      ([name]) =>
        body.includes(`./${name}`) ||
        load.includes(`./${name}`) ||
        name === "dep.mjs" ||
        (name === "m.mjs" && body.includes("other.mjs")) ||
        (name.startsWith("ring-") && body.includes("ring-")),
    ),
  );
  const scene = `const held = [];\nconst errors = [];\n${load}try {\n${body}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  if (random.chance(0.6)) return { file: "main.mjs", text: `${scene}\n`, files: used };
  if (random.chance(0.5))
    return { file: "main.mjs", text: `async function run() {\n${scene}\n}\nawait run();\n`, files: used };
  return { file: "main.cjs", text: `(async () => {\n${scene}\n})();\n`, files: used };
}
