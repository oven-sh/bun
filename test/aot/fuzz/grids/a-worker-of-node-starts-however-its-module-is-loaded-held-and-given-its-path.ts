// A file starts a Worker of node:worker_threads and prints what the Worker answers. The grid crosses seven ways to
// load the module, four ways to hold the constructor, five ways to write the path and three places of the file.
// Each case builds one of the 420 cells by itself and runs the executable without its sources. The cell answers in
// silence when the executable prints what `bun run` prints and the build warns of no Worker.
// Every cell that does not answer in silence is named in the .known.txt beside this file and is held to its line.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { withThreads } from "../../harness/flags";
import { run } from "../../harness/run";
import { partOfGrid } from "../../harness/ways";
import { test } from "../../supported";

type Kind = "esm" | "cjs" | "cts";
const extension: Record<Kind, string> = { esm: "mjs", cjs: "cjs", cts: "cts" };

const loads = ["static", "require", "getBuiltinModule", "awaited", "alias", "then", "default"] as const;
const holders = ["named", "renamed", "member", "hoisted"] as const;
const paths = ["url", "join", "filename", "resolve", "const"] as const;
const places = ["own", "package", "entry-in-package"] as const;
type Load = (typeof loads)[number];
type Holder = (typeof holders)[number];
type Path = (typeof paths)[number];

const kindOf: Record<Load, Kind> = {
  static: "esm",
  require: "cjs",
  getBuiltinModule: "esm",
  awaited: "esm",
  alias: "cts",
  then: "esm",
  default: "esm",
};

const worker = `import { parentPort } from "node:worker_threads";\nparentPort.postMessage("answer");\n`;

/** The text of the file that starts the Worker. */
function starter(load: Load, holder: Holder, path: Path): string {
  const kind = kindOf[load];
  const isEsm = kind === "esm";
  const own = path === "filename";
  // What the file reads off the module beside the constructor: a file that starts itself asks which thread it is.
  const more = own ? ["isMainThread", "parentPort"] : [];
  const head: string[] = [];
  if (path === "join" || (path === "const" && !isEsm))
    head.push(isEsm ? `import { join } from "node:path";` : `const { join } = require("node:path");`);
  if (path === "url" && !isEsm) head.push(`const { pathToFileURL } = require("node:url");`);
  const written: Record<Path, string> = {
    url: isEsm ? `new URL("./w.mjs", import.meta.url)` : `new URL("./w.mjs", pathToFileURL(__filename))`,
    join: isEsm ? `join(import.meta.dir, "w.mjs")` : `join(__dirname, "w.mjs")`,
    filename: isEsm ? `new URL(import.meta.url)` : `__filename`,
    resolve: `require.resolve("./w.mjs")`,
    const: `file`,
  };
  if (path === "const")
    head.push(isEsm ? `const file = new URL("./w.mjs", import.meta.url);` : `const file = join(__dirname, "w.mjs");`);
  const given = written[path];

  // The name under which the constructor is reached, and the names of the other members. A function that is handed the
  // module reads them off it.
  const isMember = holder === "member" || (holder === "hoisted" && (load === "alias" || load === "then"));
  const constructor = isMember ? "threads.Worker" : holder === "named" ? "Worker" : "Thread";
  const read = (name: string) => (isMember ? `threads.${name}` : name);
  const pattern = isMember
    ? "threads"
    : `{ ${[holder === "named" ? "Worker" : "Worker: Thread", ...more].join(", ")} }`;
  const [any, said, error, surely] =
    kind === "cts" ? [": any", "(said: unknown)", "(error: any)", "!"] : ["", "said", "error", ""];
  const startsIn = (indent: string, made: string) => {
    const lines = [
      `const worker${any} = ${made};`,
      `worker.once("message", ${said} => {`,
      `  console.log(said);`,
      `  worker.terminate();`,
      `});`,
      `worker.once("error", ${error} => console.log("error: " + String(error && error.message).split("\\n")[0]));`,
    ];
    const body = own
      ? [
          `if (${read("isMainThread")}) {`,
          ...lines.map(line => "  " + line),
          `} else ${read("parentPort")}${surely}.postMessage("answer");`,
        ]
      : lines;
    return body.map(line => indent + line);
  };
  const hoisted = holder === "hoisted" ? [`function start() {`, `  return new ${constructor}(${given});`, `}`] : [];
  const made = holder === "hoisted" ? `start()` : `new ${constructor}(${given})`;
  const lines: string[] = [...head];
  const module = `"node:worker_threads"`;
  switch (load) {
    case "static": {
      const clause = isMember
        ? `* as threads`
        : `{ ${[holder === "named" ? "Worker" : "Worker as Thread", ...more].join(", ")} }`;
      // The function stands above the import in the text.
      lines.push(...hoisted, `import ${clause} from ${module};`, ...startsIn("", made));
      break;
    }
    case "require":
      lines.push(...hoisted, `const ${pattern} = require(${module});`, ...startsIn("", made));
      break;
    case "getBuiltinModule":
      lines.push(...hoisted, `const ${pattern} = process.getBuiltinModule(${module});`, ...startsIn("", made));
      break;
    case "awaited":
      lines.push(...hoisted, `const ${pattern} = await import(${module});`, ...startsIn("", made));
      break;
    case "default":
      lines.push(...hoisted, `const ${pattern} = (await import(${module})).default;`, ...startsIn("", made));
      break;
    case "alias":
      lines.push(...hoisted, `import threads = require(${module});`);
      if (!isMember) lines.push(`const ${pattern} = threads;`);
      lines.push(...startsIn("", made));
      break;
    case "then":
      if (holder === "hoisted") {
        // The function that starts the Worker stands above the load and is handed the module.
        lines.push(
          `function start(threads) {`,
          ...startsIn("  ", `new ${constructor}(${given})`),
          `}`,
          `import(${module}).then(start);`,
        );
      } else {
        lines.push(
          `import(${module}).then(${isMember ? "threads" : `(${pattern})`} => {`,
          ...startsIn("  ", made),
          `});`,
        );
      }
      break;
  }
  return lines.join("\n") + "\n";
}

type Cell = [id: string, entry: string, files: Record<string, string>];
const cells: Cell[] = [];
for (const load of loads)
  for (const holder of holders)
    for (const path of paths)
      for (const place of places) {
        const id = `${load}.${holder}.${path}.${place}`;
        const ext = extension[kindOf[load]];
        const text = starter(load, holder, path);
        if (place === "own") cells.push([id, `main.${ext}`, { [`main.${ext}`]: text, "w.mjs": worker }]);
        else
          cells.push([
            id,
            place === "package" ? "main.mjs" : `node_modules/pool/index.${ext}`,
            {
              "node_modules/pool/package.json": `{ "name": "pool", "version": "1.0.0", "main": "index.${ext}" }\n`,
              [`node_modules/pool/index.${ext}`]: text,
              "node_modules/pool/w.mjs": worker,
              "main.mjs": `import "pool";\n`,
            },
          ]);
      }

// What a line of the list may say of its cell. A Worker that is lost without a warning is never expected.
const listed = ["answers, and the build warned", "no answer, and the build warned"];
const list = "a-worker-of-node-starts-however-its-module-is-loaded-held-and-given-its-path.known.txt";
const known = new Map(
  readFileSync(join(import.meta.dir, list), "utf8")
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith("#"))
    .map(line => {
      const [id, verdict] = [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)];
      if (!listed.includes(verdict)) throw new Error(`${list} says of a cell what no line may say: ${line}`);
      if (!cells.some(cell => cell[0] === id)) throw new Error(`${list} names no cell of the grid: ${line}`);
      return [id, verdict] as const;
    }),
);

// The executable stops where code of the build is interpreted.
const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

test.each(partOfGrid("starts of a Worker of node", cells, 20, ([id]) => id))(
  "%s",
  async (id, entry, files) => {
    using dir = tempDir("aot-worker-of-node", { app: files, away: {} });
    const [app, away] = [join(String(dir), "app"), join(String(dir), "away")];
    const executable = join(away, isWindows ? "main.exe" : "main");
    const plain = await run([bunExe(), "run", entry], app);
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "answer\n", exitCode: 0 });
    // One thread: with more, a debug build of the engine fails about one build in four (#48169).
    const build = [bunExe(), "build", "--compile", "--aot", withThreads(1), entry, "--outfile", executable];
    const built = await run(build, app);
    expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    const warnings = [...built.stderr.matchAll(/^warn: (TS\d+): .*\n +at (.*)$/gm)].map(
      ([, code, at]) => `${code} ${relative(app, at).replaceAll("\\", "/")}`,
    );
    renameSync(app, join(String(dir), "moved-away"));
    const ran = await run([executable], away, compiledOnly);
    const answers = ran.exitCode === 0 && ran.stdout === plain.stdout;
    const warned = warnings.some(warning => /TS10008[12]/.test(warning));
    const verdict = answers
      ? warned
        ? "answers, and the build warned"
        : "answers"
      : warned
        ? "no answer, and the build warned"
        : "NO ANSWER AND NO WARNING";
    const found = { cell: id, verdict, warnings };
    const expected = { ...found, verdict: known.get(id) ?? "answers" };
    // Beside a verdict that is not the expected one stands what the executable said.
    expect(verdict === expected.verdict ? found : { ...found, executable: ran }).toEqual(expected);
  },
  300_000,
);
