// Preloaded into one of Bun's own test files. Each `bun test` that the file starts runs as the file asked, without `--aot`. Beside it a question is asked that no
// expectation of the file asks: in a copy of the child's project every source file says, as its first statement, that it runs and in which realm. Is the list under
// `--aot` the list of a plain run: the same files, as often, in the same order? If not, the child's `exited` rejects (Bun.spawnSync throws), and the test that
// started it fails. A byte in the file AOT_CHILDREN_STARTED counts each compiled run. A child that the `$` shell starts is not asked yet.
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

function listRuns(stderr: string) {
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
  // Both copies are made before the child can write into its project.
  const copies = [copyOf(options, bun, []), copyOf(options, bun, ["--aot"])];
  const lists = copies.map(async copy => {
    const child = spawn(copy);
    const [stderr] = await Promise.all([child.stderr.text(), child.exited]);
    rmSync(copy.cwd, { recursive: true, force: true });
    return listRuns(stderr);
  });
  const child = spawn.call(this, first as never, second as never);
  const exited = Promise.all([child.exited, ...lists]).then(([code, plain, compiled]) => (hold(plain, compiled), code));
  return Object.defineProperty(child, "exited", { value: exited });
} as typeof Bun.spawn;

Bun.spawnSync = function (this: unknown, first: string[] | Options, second?: Omit<Options, "cmd">) {
  const options = optionsOf(first, second);
  const bun = findBun(options);
  if (bun < 0) return spawnSync.call(this, first as never, second as never);
  appendFileSync(process.env.AOT_CHILDREN_STARTED!, ".");
  const [plain, compiled] = [[], ["--aot"]].map(flags => {
    const copy = copyOf(options, bun, flags);
    const { stderr } = spawnSync(copy);
    rmSync(copy.cwd, { recursive: true, force: true });
    return listRuns(stderr.toString());
  });
  hold(plain, compiled);
  return spawnSync.call(this, first as never, second as never);
} as typeof Bun.spawnSync;
