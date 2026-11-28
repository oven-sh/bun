// A build with --aot gives the same executable, byte for byte, whatever the number of threads. The flow analysis goes in rounds, on 32 lanes; when this fault stood it had one lane at one thread.
// The library lays accessors in fields, and each waits until its field is asked. Who asked a field of another lane once woke it a round later than who asked a field of its own,
// so calls saw other types on the way, and what they had asked for on the way stood in the tables: two executables of this program.
import { expect } from "bun:test";
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test } from "./supported";

const sources = {
  "entry.mjs": `
import util from "node:util";
const found = util.debuglog({ toUpperCase: () => "constructor" });
console.log(
  found === Object
    ? found.getOwnPropertyDescriptor(Reflect.getPrototypeOf(function () {}), "constructor").value("return 6 * 7")()
    : "nothing is inherited",
);
`,
  // The flow asks which functions name the list where it looks for constructor functions: on a thread of its own it once asked before the answer was there.
  "methods.mjs": `
const METHODS = ["get", "post", "put"];
class App {
  constructor() { this.count = 0; }
  has(name) { return METHODS.includes(name) && METHODS.indexOf(name) >= 0; }
}
METHODS.forEach(method => {
  App.prototype[method] = function (path) { return this.has(method) ? path.length + this.count++ : -1; };
});
const app = new App();
console.log(app.get("a"), app.post("ab"), app.put("abc"), app.has("delete"));
`,
};

// An alias may name the type of a value whose annotation names other aliases of the same file. Such an annotation was once looked at on its own while those aliases were still being looked at:
// they counted as trusted there, and every thread was told. Which thread asked first decided whether `table` is of its declared type or only expected to be.
const sourcesOfNamedTypes = {
  "entry.ts": `
import { show, type Id, type Key } from "./table";
function count(names: [Key, Id]) { return names.length; }
console.log(count(["a", "b"]), show());
`,
  "table.ts": `
const names = { first: "a", second: "b", third: "c" } as const;
export type Key = (typeof names)[keyof typeof names];
interface Row { id: string; weight: number; next: string | null }
function create(): Record<Key, Row> {
  const rows = {} as Record<Key, Row>;
  for (const key of Object.values(names)) rows[key] = { id: key, weight: key.length, next: null };
  return rows;
}
export const table: Record<Key, Row> = create();
export type Id = (typeof table)[Key]["id"];
export function show() { return Object.keys(table).length + table.a.weight; }
`,
};

// The same of an alias that a package declares: no declaration of a package is trusted, so neither is `Loaded`, whichever of `Loaded | Weight` and `Loaded` is asked for first. Trusted it is where the
// program declares `Weight` itself.
function writeSidesOfUnion(order: "union first" | "union last", weight: "Grams" | "number") {
  const classes = [
    "class Both { held: Loaded | Weight; constructor(held: Loaded | Weight) { this.held = held; } kind(): string { return typeof this.held; } }",
    "class Alone { value: Loaded; constructor(value: Loaded) { this.value = value; } twice(): number { return this.value * 2; } }",
  ];
  if (order === "union last") classes.reverse();
  const filler = Array.from(
    { length: 3000 },
    (_, index) =>
      `export function fill${index}(n: number): number { let all = ${index}; for (let i = 0; i < n; i++) all = (all * 17 + i) % 7919; return all; }`,
  );
  return {
    "node_modules/units/package.json": `{ "name": "units", "version": "1.0.0", "main": "index.js", "types": "index.d.ts" }`,
    "node_modules/units/index.d.ts": `export type Grams = number;\nexport declare function weigh(): Grams;\n`,
    "node_modules/units/index.js": `exports.weigh = function () { return JSON.parse("14"); };\n`,
    "tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" } }`,
    "types.ts": `import type { Grams } from "units";\nimport { loaded } from "./data";\nexport type Weight = ${weight};\nexport type Loaded = typeof loaded;\nexport type Unused = Grams;\n`,
    "data.ts": `import { weigh } from "units";\nimport type { Weight } from "./types";\n${filler.join("\n")}\nexport const loaded: Weight = weigh();\n`,
    "entry.ts": `import type { Loaded, Weight } from "./types";\nimport { loaded, fill5 } from "./data";\n${classes.join("\n")}\nconsole.log(new Alone(loaded).twice(), fill5(4), new Both(loaded).kind());\n`,
  };
}

const written = expect.stringMatching(/^\d+ bytes, sha256 [0-9a-f]{64}$/);

// An executable is as large as Bun, so it is read a part at a time, and every part into these bytes.
const part = Buffer.allocUnsafe(16 * 1024 * 1024);

/** The length of a file and a hash of its bytes. Two files that are missing or empty would compare equal, so such a file has neither. */
function contentOf(path: string) {
  if (!statSync(path, { throwIfNoEntry: false })?.size) return "nothing is written";
  const hasher = new Bun.CryptoHasher("sha256");
  const file = openSync(path, "r");
  try {
    let length = 0;
    for (let read: number; (read = readSync(file, part)) > 0; length += read) hasher.update(part.subarray(0, read));
    return `${length} bytes, sha256 ${hasher.digest("hex")}`;
  } finally {
    closeSync(file);
  }
}

let foldersWrittenInto = 0;

/**
 * The builds of `entry` in `folder`, one on each number of threads, as many at once as there are slots. Besides its executable a build writes the program that its
 * front end hands to the engine. With `--explain=statistics` it says what it counts instead.
 */
const buildsOn = (threadCounts: number[], folder: string, entry: string, counting?: "--explain=statistics") =>
  Promise.all(
    threadCounts.map(threads =>
      slot(async () => {
        // An executable holds its own file name, so the builds that are compared write one name, each into a folder of its own.
        const into = `${folder}-${++foldersWrittenInto}`;
        const [program, executable] = [join(into, "compiled.ir"), join(into, isWindows ? "compiled.exe" : "compiled")];
        mkdirSync(into);
        const build = await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            ...withoutDebugInformation,
            "--aot",
            `--aot-threads=${threads}`,
            counting ?? `--aot-out=${program}`,
            entry,
            "--outfile",
            executable,
          ],
          folder,
          bunEnv,
        );
        const files = { program: contentOf(program), executable: contentOf(executable) };
        // The executable is as large as Bun, and the next build in this slot writes another.
        rmSync(into, { recursive: true, force: true });
        const counted = `${build.stdout}\n${build.stderr}`.matchAll(/^ *((?:Accesses|Values)[A-Za-z]+):? +(\d+) *$/gm);
        const counts = Object.fromEntries(Array.from(counted, ([, name, count]) => [name, Number(count)]));
        return { threads, build, ...files, counts };
      }),
    ),
  );
type Builds = Awaited<ReturnType<typeof buildsOn>>;

/** Every build ended well and wrote an executable, and each left what the first left: the same bytes and the same counts. */
function expectSame(builds: Builds) {
  for (const { build } of builds) built(build);
  const left = builds.map(({ threads, program, executable, counts }) => ({ threads, program, executable, counts }));
  expect(left[0].executable).toEqual(written);
  expect(left).toEqual(left.map(({ threads }) => ({ ...left[0], threads })));
}

function expectSameBytes(builds: Builds) {
  expectSame(builds);
  expect(builds[0].program).toEqual(written);
}

function expectSameCounts(builds: Builds) {
  expectSame(builds);
  expect(Object.keys(builds[0].counts)).not.toBeEmpty();
}

describe.concurrent("compile/aot/builds-on-one-thread-and-on-several-give-the-same-bytes", () => {
  test("builds on one, two and eight threads are equal", async () => {
    using dir = tempDir("aot-same-bytes-by-threads", { project: sources });
    expectSameBytes(await buildsOn([1, 2, 8], join(String(dir), "project"), "./entry.mjs"));
  }, 600_000);

  test("builds of methods laid under a list of names are equal on one, two and eight threads", async () => {
    using dir = tempDir("aot-same-bytes-by-threads", { project: sources });
    expectSameBytes(await buildsOn([1, 2, 8], join(String(dir), "project"), "./methods.mjs"));
  }, 600_000);

  test("builds of types that name each other are equal on one thread and on many", async () => {
    using dir = tempDir("aot-same-bytes-by-threads-named-types", { project: sourcesOfNamedTypes });
    expectSameBytes(await buildsOn([1, 4, 16, 32], join(String(dir), "project"), "./entry.ts"));
  }, 600_000);

  test("an alias that a package declares is trusted through no value, on any number of threads", async () => {
    using dir = tempDir("aot-same-bytes-by-threads-union", {
      "union-first": writeSidesOfUnion("union first", "Grams"),
      "union-last": writeSidesOfUnion("union last", "Grams"),
      "own-alias": writeSidesOfUnion("union first", "number"),
    });
    const [unionFirst, unionLast, ownAlias] = ["union-first", "union-last", "own-alias"].map(name =>
      join(String(dir), name),
    );
    const [builds, ofUnionLast, ofOwnAlias, ofUnionFirst] = await Promise.all([
      buildsOn([1, 4, 16, 32], unionFirst, "./entry.ts"),
      buildsOn([1, 8], unionLast, "./entry.ts", "--explain=statistics"),
      buildsOn([1], ownAlias, "./entry.ts", "--explain=statistics"),
      buildsOn([1, 8], unionFirst, "./entry.ts", "--explain=statistics"),
    ]);
    expectSameBytes(builds);
    // On any number of threads: a program counts on eight threads what it counts on one, and writes the same executable.
    for (const counted of [ofUnionLast, ofOwnAlias, ofUnionFirst]) expectSameCounts(counted);
    // Through no value: the counts are not those of the program that declares `Weight` itself, whichever side of the union comes first.
    const [untrusted, trusted] = [ofUnionLast[0].counts, ofOwnAlias[0].counts];
    expect(trusted).not.toEqual(untrusted);
    expect(ofUnionFirst[0].counts).toEqual(untrusted);
  }, 600_000);
});
