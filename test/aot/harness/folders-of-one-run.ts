import { bunEnv, bunExe, tempDir } from "harness";
import { runsWholeGrids } from "./ways";

/**
 * The projects of a test file as the folders of one project. A run in layers compiles all of Bun's own library, whatever stands over it, so a way of building is paid once
 * for all of them. Each folder has its own files and packages, and `--isolate` gives each test file a realm of its own. Two things cross. What a build finds in one program
 * holds for the whole program: projects whose packages differ in what the build has to find are told apart only alone. And under plain Bun a handler in Module._extensions
 * outlives its realm: a test file puts back what it replaced.
 * AOT_WHOLE_GRIDS=1, or `alone`: the project by itself.
 */
export function foldersOfOneRun(name: string, projects: Record<string, Record<string, string>>) {
  const names = Object.keys(projects);
  const runs = new Map<string, ReturnType<typeof ran>>();

  async function ran(together: string[], flags: string[], words?: string) {
    const folderOf = (project: string) => (together.length > 1 ? `c${names.indexOf(project) + 1}/` : "");
    const files = together.flatMap(project =>
      Object.entries(projects[project]).map(([path, text]) => [folderOf(project) + path, text]),
    );
    using dir = tempDir(name, Object.fromEntries(files));
    await using run = Bun.spawn({
      cmd: [bunExe(), "test", ...flags, "--isolate"],
      cwd: String(dir),
      env: words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
    // What is said ahead of the first test file is said of them all.
    const lines = new Map<string, string[]>([["", []]]);
    const failed = new Set<string>();
    let folder = "";
    for (const line of stderr.split("\n")) {
      const [, file] = line.match(/^(\S+\.test\.\w+):$/) ?? [];
      if (file) folder = file.slice(0, file.search(/[\\/]/) + 1).replace("\\", "/");
      else if (line.startsWith("(fail) ")) failed.add(folder);
      else if (/^(OUT|error)/.test(line)) lines.getOrInsertComputed(folder, () => []).push(line);
    }
    return (project: string) => ({
      lines: folderOf(project) ? [...lines.get("")!, ...(lines.get(folderOf(project)) ?? [])] : lines.get("")!,
      // A run ends with 1 where a test has failed: that is held against the folder of the test alone.
      exitCode: exitCode === 1 && failed.size > 0 && !failed.has(folderOf(project)) ? 0 : exitCode,
    });
  }

  /** The lines of stderr that begin with OUT or error and belong to the project, and how the run ended. */
  return async function linesOf(project: string, flags: string[], words?: string, alone = runsWholeGrids) {
    const together = alone ? [project] : names;
    const run = runs.getOrInsertComputed(JSON.stringify([together, flags, words]), () => ran(together, flags, words));
    return (await run)(project);
  };
}
