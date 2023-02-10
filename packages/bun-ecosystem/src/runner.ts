import type { Package } from "./packages";
import { packages } from "./packages";
import { existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { globby } from "globby";

for (const pkg of packages) {
  try {
    await loadPackage(pkg, "tmp");
  } catch (error) {
    console.error(pkg.name, error);
  }
}

async function loadPackage(pkg: Package, cwd?: string): Promise<void> {
  await gitClone({
    cwd,
    repository: pkg.repository,
    name: pkg.name,
  });
  const dir = join(cwd ?? "", pkg.name, pkg.cwd ?? "");
  await spawn({
    cwd: dir,
    cmd: ["bun", "install"],
  });
  if (!pkg.tests || pkg.tests.style !== "jest") {
    return;
  }
  const files = await globby(pkg.tests.include, {
    cwd: dir,
    ignore: pkg.tests.exclude ?? [crypto.randomUUID()],
    onlyFiles: true,
    caseSensitiveMatch: false,
  });
  if (!files.length) {
    throw new Error("No tests found");
  }
  for (const file of files) {
    let path = file;
    if (!file.includes(".test.")) {
      const ext = path.lastIndexOf(".");
      path = file.substring(0, ext) + ".test" + file.substring(ext);
      copyFileSync(join(dir, file), join(dir, path));
    }
    await spawn({
      cwd: dir,
      cmd: ["bun", "wiptest", path],
    });
  }
}

type GitCloneOptions = {
  repository: string;
  cwd?: string;
  name?: string;
};

async function gitClone(options: GitCloneOptions): Promise<void> {
  const name = options.name ?? dirname(options.repository);
  const cwd = options.cwd ?? process.cwd();
  const path = join(cwd, name);
  if (existsSync(path)) {
    await spawn({
      cwd: path,
      cmd: ["git", "pull"],
    });
  } else {
    const url = `${options.repository}`;
    await spawn({
      cwd,
      cmd: ["git", "clone", "--single-branch", "--depth", "1", url, name],
    });
  }
}

type SpawnOptions = {
  cwd: string;
  cmd: string[];
};

async function spawn({ cwd, cmd }: SpawnOptions) {
  const { exited } = await Bun.spawn({
    cwd,
    cmd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await exited;
  if (exitCode !== 0) {
    throw new Error(`"${cmd.join(" ")}" exited with ${exitCode}`);
  }
}
