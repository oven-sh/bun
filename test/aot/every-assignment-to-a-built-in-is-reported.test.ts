// docs/compiler/compatibility.mdx: the build reports each assignment to a read-only built-in that it can see as TS100014. Here one built-in is assigned to in several places.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

/** Builds ./main.js and returns where TS100014 is reported, each as `<severity> <file>:<line>`, sorted. */
async function reportedPlaces(files: Record<string, string>) {
  using dir = tempDir("aot-assignments-to-built-ins", files);
  const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", outfile],
    String(dir),
  );
  const lines = stderr.split(/\r?\n/);
  const places = lines.flatMap((line, index) => {
    const severity = /^(warn|error): TS100014: /.exec(line)?.[1];
    const place = /([^\\/]+:\d+):\d+$/.exec(lines[index + 1] ?? "")?.[1];
    return severity ? [`${severity} ${place}`] : [];
  });
  return { places: places.sort(), exitCode };
}

const rarely = "process.argv.length > 9";

test("three modules that each assign to one global name", async () => {
  const assigns = `// The assignment is on the second line.\nif (${rarely}) Float32Array = Array;\n`;
  expect(
    await reportedPlaces({
      "main.js": `import "./a.js";\nimport "./b.js";\nimport "./c.js";\nconsole.log(typeof Float32Array);\n`,
      "a.js": assigns,
      "b.js": assigns,
      "c.js": assigns,
    }),
  ).toEqual({ places: ["warn a.js:2", "warn b.js:2", "warn c.js:2"], exitCode: 0 });
}, 120_000);

test("several places in one module, in and out of functions", async () => {
  expect(
    await reportedPlaces({
      "main.js": [
        `if (${rarely}) Float32Array = Array;`,
        `if (${rarely}) globalThis.Float32Array = Array;`,
        `function later() {`,
        `  Float32Array = Array;`,
        `}`,
        `const evenLater = () => {`,
        `  Float32Array = Array;`,
        `};`,
        `if (${rarely}) later(), evenLater();`,
        `console.log(typeof Float32Array);`,
      ].join("\n"),
    }),
  ).toEqual({ places: ["warn main.js:1", "warn main.js:2", "warn main.js:4", "warn main.js:7"], exitCode: 0 });
}, 120_000);

test("a store, a delete and a definition of one member", async () => {
  expect(
    await reportedPlaces({
      "main.js": [
        `const replacement = () => 0;`,
        `if (${rarely}) Math.floor = replacement;`,
        `if (${rarely}) delete Math.floor;`,
        `if (${rarely}) Object.defineProperty(Math, "floor", { value: replacement });`,
        `if (${rarely}) Math.ceil = replacement;`,
        `console.log(Math.floor(1.5), Math.ceil(1.5));`,
      ].join("\n"),
    }),
  ).toEqual({ places: ["warn main.js:2", "warn main.js:3", "warn main.js:4", "warn main.js:5"], exitCode: 0 });
}, 120_000);

test("an assignment in a finally block is one place", async () => {
  expect(
    await reportedPlaces({
      "main.js": [
        `function attempt() {`,
        `  try {`,
        `    if (${rarely}) return 1;`,
        `  } finally {`,
        `    if (${rarely}) Float32Array = Array;`,
        `  }`,
        `  return 2;`,
        `}`,
        `console.log(attempt());`,
      ].join("\n"),
    }),
  ).toEqual({ places: ["warn main.js:5"], exitCode: 0 });
}, 120_000);

test("a store to __proto__, Object.setPrototypeOf and Reflect.setPrototypeOf", async () => {
  expect(
    await reportedPlaces({
      "main.js": [
        `const held = WeakMap;`,
        `if (${rarely}) Uint8ClampedArray.__proto__ = {};`,
        `if (${rarely}) Object.setPrototypeOf(Uint8ClampedArray, {});`,
        `if (${rarely}) Object.setPrototypeOf(Uint8ClampedArray.prototype, {});`,
        `if (${rarely}) Object.setPrototypeOf(Math, null);`,
        `if (${rarely}) Object.setPrototypeOf(held, {});`,
        `if (${rarely}) console.log(Reflect.setPrototypeOf(Uint8ClampedArray, {}));`,
        `// The prototype that it has already, and objects of the program.`,
        `Object.setPrototypeOf(Map.prototype, Object.prototype);`,
        `console.log(Reflect.setPrototypeOf(Map, Function.prototype));`,
        `class Mine extends Map {}`,
        `Object.setPrototypeOf(Mine.prototype, {});`,
        `Object.setPrototypeOf({}, Map.prototype);`,
      ].join("\n"),
    }),
  ).toEqual({
    places: [
      "warn main.js:2",
      "warn main.js:3",
      "warn main.js:4",
      "warn main.js:5",
      "warn main.js:6",
      "warn main.js:7",
    ],
    exitCode: 0,
  });
}, 120_000);

test("one that always runs, and others that may", async () => {
  expect(
    await reportedPlaces({
      "main.js": `import "./a.js";\nif (${rarely}) Math.floor = () => 0;\nMath.floor = () => 1;\n`,
      "a.js": `if (${rarely}) Math.floor = () => 2;\n`,
    }),
  ).toEqual({ places: ["error main.js:3", "warn a.js:1", "warn main.js:2"], exitCode: 1 });
}, 120_000);
