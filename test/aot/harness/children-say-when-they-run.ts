// Preloaded into one of Bun's own test files. Each `bun test` that the file starts runs as the file asked, without `--aot`. Beside it a question is asked that no
// expectation of the file asks: in a copy of the child's project every source file says, as its first statement, that it runs and in which realm. Is the list under
// `--aot` the list of a plain run: the same files, as often, in the same order? If not, nor that of a plain run that reads its files on one thread
// (`withoutReadingThread`), the child's `exited` rejects (Bun.spawnSync throws), and the test that started it fails. A byte in the file AOT_CHILDREN_STARTED
// counts each compiled run. A child that the `$` shell starts is not asked yet.
// A run that was cut off, by a limit of time or by its death, ran fewer files than it would have: it is no list, plain or compiled. The test fails by what cut the run off, and a line
// in the file AOT_CHILDREN_STOPPED says so.
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

type Options = { cmd: string[]; cwd?: string; env?: Record<string, string | undefined> };

const { spawn, spawnSync } = Bun;
// As in ./children-under-aot.ts.
process.env.BUN_FEATURE_FLAG_NO_ORPHANS = "1";
const isSource = (name: string) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(name) && !/\.d\.[cm]?ts$/.test(name);

function letFilesSayWhenTheyRun(folder: string, root = folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) letFilesSayWhenTheyRun(path, root);
    if (!entry.isFile() || !isSource(entry.name)) continue;
    const says = `console.error(${JSON.stringify(`RUNS ${relative(root, path)} `)} + (globalThis.__realmOfRuns ??= Math.random().toString(36).slice(2, 8)));`;
    const text = readFileSync(path, "utf8");
    // A hashbang or a directive stays first.
    const first =
      text.startsWith("#!") || /^\s*["']use /.test(text) ? text.slice(0, text.indexOf("\n") + 1 || text.length) : "";
    writeFileSync(path, first + (first && !first.endsWith("\n") ? "\n" : "") + says + " " + text.slice(first.length));
  }
}

/** The child's command on a copy of its project that says what runs. */
function copyOf({ cmd, cwd, env }: Options, bun: number, flags: string[]) {
  const from = realpathSync(cwd ?? process.cwd());
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "aot-runs-")));
  cpSync(from, folder, { recursive: true, verbatimSymlinks: true });
  letFilesSayWhenTheyRun(folder);
  const inCopy = (text: string) => text.replaceAll(from, folder);
  return {
    cmd: [...cmd.slice(0, bun + 2), ...flags, ...cmd.slice(bun + 2).map(inCopy)],
    cwd: folder,
    env: Object.fromEntries(Object.entries(env ?? process.env).map(([name, value]) => [name, value && inCopy(value)])),
    stdio: ["ignore", "ignore", "pipe"] as ["ignore", "ignore", "pipe"],
    timeout: 240_000,
  };
}

type Ended = { exitCode: number | null; signalCode?: unknown };

function listRuns(flags: string[], stderr: string, { exitCode, signalCode }: Ended) {
  const cutOffBy = signalCode
    ? `was ended by ${signalCode}`
    : (exitCode ?? 128) >= 128
      ? `ended with the code ${exitCode}`
      : /\btimed out after \d+ms/.exec(stderr)?.[0];
  if (cutOffBy) {
    const says = `the ${flags.length ? "compiled" : "plain"} copy ${cutOffBy}: what it ran is no list of runs`;
    appendFileSync(process.env.AOT_CHILDREN_STOPPED!, says + "\n");
    throw new Error(says + "\n" + stderr.slice(-2000));
  }
  const realms = new Map<string, number>();
  const numberOf = (realm: string) => realms.get(realm) ?? realms.set(realm, realms.size + 1).size;
  return [...stderr.matchAll(/^RUNS (.*) (\w+)$/gm)]
    .map(([, file, realm]) => `${file} in realm ${numberOf(realm)}`)
    .join("\n  ");
}

function hold(plain: string, compiled: string) {
  if (plain !== compiled)
    throw new Error(
      `the list of runs under --aot is not the list of a plain run\nplain:\n  ${plain}\ncompiled:\n  ${compiled}`,
    );
}

// `bun test` reads each file of a project on another thread, and which file comes back first can decide what runs where nothing waits for the call that asked
// (docs/compiler/compatibility.mdx, "Under `bun test --aot`"). Without that thread a project has one list in every run. So where the two lists part, plain is asked
// once more without it, and that list counts if it is the compiled one: ../mock-sweep-cases.ts holds a compiled run to a plain run with the thread or without it
// in the same way. The compiled run is not asked again.
const withoutReadingThread = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

/** What hold() throws for two lists, or nothing. */
function parting(...lists: Parameters<typeof hold>) {
  try {
    hold(...lists);
  } catch (error) {
    return error;
  }
}

type List = Parameters<typeof hold>[0];

/** Whether the second plain run has the list of the compiled run. One that was cut off has no list, which listRuns() has noted: the first verdict stands. */
const agrees = (again: List | undefined, compiled: List) => again !== undefined && !parting(again, compiled);

// Not through console.error(), which a suite may have replaced. ./runner-suites.ts prints the line.
function sayThatPlainWavered({ cmd, cwd }: Options, bun: number) {
  const testFiles = readdirSync(cwd ?? process.cwd()).filter(name => /\.(?:test|spec)\./.test(name));
  process.stderr.write(
    `THE REFERENCE WAVERED: \`bun ${cmd.slice(bun + 1).join(" ")}\` beside ${testFiles.join(", ") || "no test file"}: the first plain run had another list than the compiled run, and a plain run that reads its files on one thread had the same\n`,
  );
}

const madeForTheRun = realpathSync(tmpdir()) + sep;
const findBun = ({ cmd, cwd }: Options) => {
  // ./run.ts puts words in front of a command.
  const bun = cmd.indexOf(process.execPath);
  // A project that the suite has made for the run is copied. A folder of the repository is not.
  return bun >= 0 && cmd[bun + 1] === "test" && realpathSync(cwd ?? process.cwd()).startsWith(madeForTheRun) ? bun : -1;
};
const optionsOf = (first: string[] | Options, second?: Omit<Options, "cmd">): Options =>
  Array.isArray(first) ? { ...second, cmd: first } : first;

Bun.spawn = function (this: unknown, first: string[] | Options, second?: Omit<Options, "cmd">) {
  const options = optionsOf(first, second);
  const bun = findBun(options);
  if (bun < 0) return spawn.call(this, first as never, second as never);
  appendFileSync(process.env.AOT_CHILDREN_STARTED!, ".");
  const listOf = async (copy: ReturnType<typeof copyOf>, flags: string[]) => {
    const child = spawn(copy);
    const [stderr] = await Promise.all([child.stderr.text(), child.exited]);
    rmSync(copy.cwd, { recursive: true, force: true });
    return listRuns(flags, stderr, child);
  };
  // Every copy is made before the child can write into its project. The last one runs only where plain is asked again.
  const [plainCopy, compiledCopy, spare] = [[], ["--aot"], []].map(flags => copyOf(options, bun, flags));
  const lists = [listOf(plainCopy, []), listOf(compiledCopy, ["--aot"])];
  const child = spawn.call(this, first as never, second as never);
  const exited = Promise.all([child.exited, ...lists])
    .then(async ([code, plain, compiled]) => {
      const parted = parting(plain, compiled);
      if (!parted) return code;
      const again = await listOf({ ...spare, env: { ...spare.env, ...withoutReadingThread } }, []).catch(
        () => undefined,
      );
      if (!agrees(again, compiled)) throw parted;
      sayThatPlainWavered(options, bun);
      return code;
    })
    .finally(() => rmSync(spare.cwd, { recursive: true, force: true }));
  return Object.defineProperty(child, "exited", { value: exited });
} as typeof Bun.spawn;

Bun.spawnSync = function (this: unknown, first: string[] | Options, second?: Omit<Options, "cmd">) {
  const options = optionsOf(first, second);
  const bun = findBun(options);
  if (bun < 0) return spawnSync.call(this, first as never, second as never);
  appendFileSync(process.env.AOT_CHILDREN_STARTED!, ".");
  // The child runs last, so each copy is of its project as it was.
  const listOf = (flags: string[], env: Record<string, string> = {}) => {
    const copy = copyOf(options, bun, flags);
    const ended = spawnSync({ ...copy, env: { ...copy.env, ...env } });
    rmSync(copy.cwd, { recursive: true, force: true });
    return listRuns(flags, ended.stderr.toString(), ended);
  };
  const [plain, compiled] = [[], ["--aot"]].map(flags => listOf(flags));
  const parted = parting(plain, compiled);
  if (parted) {
    let again: List | undefined;
    try {
      again = listOf([], withoutReadingThread);
    } catch {
      again = undefined;
    }
    if (!agrees(again, compiled)) throw parted;
    sayThatPlainWavered(options, bun);
  }
  return spawnSync.call(this, first as never, second as never);
} as typeof Bun.spawnSync;
