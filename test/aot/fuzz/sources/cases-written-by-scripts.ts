// Tables of small programs that the scripts in ../made write: `python3 <topic>.py <folder>` writes one folder a case (its entry point is the file named main) or one file a case, and the top
// of each script says what its cases are about. Three of the scripts write one random program for a seed. All cases are written once, at the first draw, into a temporary folder; seed n
// draws case n of them all. Without python3 nothing is drawn.
import { spawnSync } from "bun";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { asProgram, type Drawn, type Made } from "../family";

const scripts = join(import.meta.dir, "..", "made");
const python = Bun.which("python3");
/** These write one random program, `<topic>.py <seed> <folder>`: so many seeds of each are cases. */
const random: Record<string, number> = {
  "random-commonjs-and-esm": 200,
  "random-commonjs-and-esm-with-hooks": 200,
  "random-esm-namespace-as-value": 200,
};
/** Cases that do not end, in plain Bun or in an executable built without --aot, and those that ../made/not-held-to-plain-bun.txt names. */
const without = new Set([
  "buffer-statics-partial-objects-host-records response-json-of-records",
  "top-level-symbols a-worker-has-its-own",
  "values-of-another-realm a-promise-of-another-realm",
  ...readFileSync(join(scripts, "not-held-to-plain-bun.txt"), "utf8")
    .split("\n")
    .filter(line => line && !line.startsWith("#")),
]);
/** What a case without a tsconfig.json of its own is checked under. */
const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleDetection: "force",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    allowJs: true,
    resolveJsonModule: true,
    noEmit: true,
    strict: true,
  },
});

function filesUnder(folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true }))
    if (entry.isFile())
      files[relative(folder, join(entry.parentPath, entry.name))] = readFileSync(
        join(entry.parentPath, entry.name),
        "utf8",
      );
  return files;
}

const whole = (files: Record<string, string>): Made | undefined => {
  const file = Object.keys(files).find(name => /^main\.[a-z]+$/.test(name));
  if (!file) return;
  const { [file]: text, ...rest } = files;
  return { file, text, files: { "tsconfig.json": tsconfig, ...rest } };
};

function casesOf(topic: string, root: string): [name: string, made: Made][] {
  const write = (...words: string[]) =>
    spawnSync({
      cmd: [python!, "-B", join(scripts, `${topic}.py`), ...words],
      env: { ...process.env, PYTHONUTF8: "1", AOT_DEEPEST_NEST: "600" },
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;
  const folder = join(root, topic);
  if (topic in random) {
    for (let seed = 1; seed <= random[topic]; seed++) write(String(seed), join(folder, `seed-${seed}`));
  } else if (!write(folder)) return [];
  const written = readdirSync(folder, { withFileTypes: true });
  const alone = Object.fromEntries(
    written.filter(entry => entry.isFile()).map(entry => [entry.name, readFileSync(join(folder, entry.name), "utf8")]),
  );
  const stem = (file: string) => file.replace(/(\.d)?\.[a-z]+$/, "");
  const filesNamedIn = (text: string) => Object.keys(alone).filter(file => text.includes(`"./${stem(file)}`));
  // A file that another one imports is no case of its own: it goes with each case that names it.
  const imported = new Set(
    Object.entries(alone).flatMap(([file, text]) => filesNamedIn(text).filter(other => stem(other) !== stem(file))),
  );
  const cases: [string, Made | undefined][] = [];
  for (const entry of written) {
    if (entry.isDirectory()) cases.push([entry.name, whole(filesUnder(join(folder, entry.name)))]);
    else if (/(?<!\.d)\.(ts|js|mjs|cjs)$/.test(entry.name) && !imported.has(entry.name))
      cases.push([
        stem(entry.name),
        whole({
          ...Object.fromEntries(filesNamedIn(alone[entry.name]).map(file => [file, alone[file]])),
          [entry.name.replace(/^.*(?=\.[a-z]+$)/, "main")]: alone[entry.name],
        }),
      ]);
  }
  return cases.filter((each): each is [string, Made] => !!each[1] && !without.has(`${topic} ${each[0]}`)).sort();
}

let cases: [topic: string, name: string, made: Made][] | undefined;
function all() {
  const root = mkdtempSync(join(tmpdir(), "cases-written-by-scripts-"));
  try {
    return readdirSync(scripts)
      .flatMap(file => (file.endsWith(".py") ? file.slice(0, -3) : []))
      .sort()
      .flatMap(topic => casesOf(topic, root).map(([name, made]): [string, string, Made] => [topic, name, made]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const drawn: Drawn = (seed, bed) => {
  if (!python || bed.name !== "product") return;
  cases ??= all();
  if (!cases.length) return;
  const [topic, name, made] = cases[seed % cases.length];
  const program = asProgram(made);
  return program && { seed, ...program, notes: `${topic} ${name}`, group: topic, standsAlone: true };
};
export default drawn;
