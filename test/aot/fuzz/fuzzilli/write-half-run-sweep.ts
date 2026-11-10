// A CommonJS file that has not run to its end loads an ES module that imports from it: the entry, times whether the other CommonJS file has run, times what the first ES module imports, times what the
// CommonJS file does while it runs, times what the second ES module imports, times how a name lies on the exports, times whether a name is lacking. Each program is a graph of five small files and is built
// alone.
//
//   bun write-half-run-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<entry>--<before>--<first>--<deed>--<second>--<laid>--<names>.cjs or .mjs
//   bun write-half-run-sweep.ts count
//   bun write-half-run-sweep.ts named <pattern> <folder> [most]
//
// The files of a program stand in one file, each behind a line `// @filename: ./<path>`; what stands in front of the first such line is the entry.
//
// An ES module that imports a name from a CommonJS file reads that name off the file's exports when it is linked, and a getter there runs. Every file says when it begins and when it ends and every getter
// says when it is read, so what is printed is the order in which the files of the graph are run and their exports are read. That order is plain to see where each file has run to its end before the next
// one asks for it. Here one of them has not.
import { mkdirSync, writeFileSync } from "fs";

// What stands in the entry in front of LOADS, how it loads `./m1.mjs`, and the kind of file it is. BEFORE is the load of `./m4.cjs`, or nothing.
const entries: [string, string, string, string][] = [
  [
    "a-commonjs-entry-requires",
    'require("./m4.cjs");',
    'try {\n  require("./m1.mjs");\n} catch (error) {\n  console.log("main caught", error.name);\n}',
    "cjs",
  ],
  ["an-es-entry-imports", 'import "./m4.cjs";', 'import "./m1.mjs";', "mjs"],
  [
    "an-es-entry-imports-at-run-time",
    'await import("./m4.cjs");',
    'try {\n  await import("./m1.mjs");\n} catch (error) {\n  console.log("main caught", error.name);\n}',
    "mjs",
  ],
];

const befores = ["other-has-run", "other-has-not-run"] as const;

// NAME is `first`, or a name that the file lacks.
const firsts: [string, string][] = [
  [
    "half-run-then-other",
    'import { first as a } from "./m3.cjs";\nimport { NAME as b } from "./m4.cjs";\nconsole.log("m1", a, b);',
  ],
  [
    "other-then-half-run",
    'import { NAME as b } from "./m4.cjs";\nimport { first as a } from "./m3.cjs";\nconsole.log("m1", a, b);',
  ],
  ["half-run-alone", 'import { first as a } from "./m3.cjs";\nconsole.log("m1", a);'],
];

const deeds: [string, string][] = [
  ["requires-a-second-module", 'require("./m6.mjs");'],
  [
    "requires-it-and-catches",
    'try {\n  require("./m6.mjs");\n} catch (error) {\n  console.log("m3 caught", error.name);\n}',
  ],
  ["requires-the-other-then-it", 'require("./m4.cjs");\nrequire("./m6.mjs");'],
  [
    "requires-its-loader",
    'try {\n  require("./m1.mjs");\n} catch (error) {\n  console.log("m3 caught", error.name);\n}',
  ],
  ["loads-nothing", ""],
];

const seconds: [string, string][] = [
  [
    "a-name-of-other-then-half-run",
    'import x, { NAME as n } from "./m4.cjs";\nimport y from "./m3.cjs";\nconsole.log("m6", typeof x, typeof y, n);',
  ],
  [
    "half-run-then-a-name-of-other",
    'import y from "./m3.cjs";\nimport x, { NAME as n } from "./m4.cjs";\nconsole.log("m6", typeof x, typeof y, n);',
  ],
  ["both-whole", 'import x from "./m4.cjs";\nimport y from "./m3.cjs";\nconsole.log("m6", typeof x, typeof y);'],
  [
    "both-as-namespaces",
    'import * as x from "./m4.cjs";\nimport * as y from "./m3.cjs";\nconsole.log("m6", Object.keys(x).join(), Object.keys(y).join());',
  ],
];

// M is the name of the file.
const laids: [string, string][] = [
  [
    "a-getter-defined",
    'Object.defineProperty(exports, "first", {\n  enumerable: true,\n  get() {\n    console.log("M.first is read");\n    return "M";\n  },\n});',
  ],
  [
    "a-getter-of-a-record",
    'module.exports = {\n  get first() {\n    console.log("M.first is read");\n    return "M";\n  },\n};',
  ],
  ["a-value", 'exports.first = "M";'],
  [
    "a-getter-of-a-class",
    'module.exports = new (class {\n  get first() {\n    console.log("M.first is read");\n    return "M";\n  }\n})();',
  ],
];

const names: [string, string, string][] = [
  ["all-names-there", "first", "first"],
  ["first-module-lacks-a-name", "second", "first"],
  ["second-module-lacks-a-name", "first", "second"],
];

const all =
  entries.length * befores.length * firsts.length * deeds.length * seconds.length * laids.length * names.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [deed, done] = pick(deeds);
  const [second, secondImports] = pick(seconds);
  const [first, firstImports] = pick(firsts);
  const before = pick(befores);
  const [entry, loadsTheOther, loads, kind] = pick(entries);
  const [laid, lays] = pick(laids);
  const [named, inTheFirst, inTheSecond] = pick(names);
  const file = (path: string, lines: (string | false)[]) => [`// @filename: ./${path}`, ...lines.filter(Boolean)];
  const text = [
    'console.log("main begins");',
    before === "other-has-run" && loadsTheOther,
    loads,
    'console.log("main ends");',
    ...file("m1.mjs", [firstImports.replace("NAME", inTheFirst)]),
    ...file("m3.cjs", ['console.log("m3 begins");', lays.replaceAll("M", "m3"), done, 'console.log("m3 ends");']),
    ...file("m4.cjs", ['console.log("m4 begins");', lays.replaceAll("M", "m4"), 'console.log("m4 ends");']),
    ...file("m6.mjs", [secondImports.replace("NAME", inTheSecond)]),
  ]
    .filter(Boolean)
    .join("\n");
  return { name: `${entry}--${before}--${first}--${deed}--${second}--${laid}--${named}.${kind}`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
