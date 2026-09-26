/**
 * All of bun as an image: bun's own build, `bun scripts/build.ts --profile=portable`, against the sysroot
 * of the output directory.
 *
 * The build is confined to as many CPUs of this machine as it has jobs, and its nested cmake build of
 * WebKit gets the same number. Everything it prints goes to <out>/logs/bun.log and to the terminal.
 * <out>/logs/bun.exit holds its exit code once it has ended, so that a build that was started in the
 * background can be waited for.
 *
 * What it builds is in the build directory of bun's build (build/release-portable in the repository),
 * not in the output directory: bun and bun-profile.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPOSITORY } from "../flags.ts";
import { type Context, inOut, logOf } from "./context.ts";
import { webkitSource } from "./jsc.ts";
import { BuildError, commandLine } from "./run.ts";

/** The first `count` CPUs that this process may run on, as taskset wants them. */
function allowedCpus(count: number): string {
  const status = readFileSync("/proc/self/status", "utf8");
  const list = /^Cpus_allowed_list:\s*(\S+)/m.exec(status)?.[1] ?? `0-${count - 1}`;
  const cpus: number[] = [];
  for (const part of list.split(",")) {
    const [first, last] = part.split("-").map(Number);
    for (let cpu = first!; cpu <= (last ?? first!); cpu++) cpus.push(cpu);
  }
  return cpus.slice(0, count).join(",");
}

/** `args` go to scripts/build.ts after the profile and the number of jobs. Returns whether the build passed. */
export async function buildBun(ctx: Context, args: string[]): Promise<boolean> {
  if (ctx.arch !== "x86_64") throw new BuildError("bun's build has the profile `portable` for x86_64 only");
  const webkit = webkitSource(ctx);
  webkit.fetch();
  const env: Record<string, string> = {
    BUN_WEBKIT_PATH: webkit.dir,
    BUN_PORTABLE_SYSROOT: ctx.sysroot.root,
    // Archives, ccache and the pinned ninja of this build only.
    BUN_BUILD_CACHE_DIR: inOut(ctx, "cache"),
    CMAKE_BUILD_PARALLEL_LEVEL: String(ctx.jobs),
  };
  const cmd = [
    "taskset",
    "-c",
    allowedCpus(ctx.jobs),
    process.execPath,
    "scripts/build.ts",
    "--profile=portable",
    `-j${ctx.jobs}`,
    ...args,
  ];
  const logPath = logOf(ctx, "bun");
  const exitPath = inOut(ctx, "logs", "bun.exit");
  mkdirSync(inOut(ctx, "logs"), { recursive: true });
  rmSync(exitPath, { force: true });
  const log = createWriteStream(logPath);
  const started = Date.now();
  log.write(`# cwd: ${REPOSITORY}\n# env: ${JSON.stringify(env)}\n# ${commandLine(cmd)}\n`);
  const child = Bun.spawn(cmd, {
    cwd: REPOSITORY,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const copy = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      log.write(chunk);
      process.stdout.write(chunk);
    }
  };
  await Promise.all([copy(child.stdout), copy(child.stderr)]);
  const code = await child.exited;
  const line = `# exit ${code} after ${Math.round((Date.now() - started) / 1000)}s\n`;
  process.stdout.write(line);
  // The exit file is written after the log is complete on disk: whoever waits for it can read the whole log.
  await new Promise<void>(done => log.end(line, () => done()));
  writeFileSync(exitPath, `${code}\n`);
  const image = join(REPOSITORY, "build", "release-portable", "bun");
  if (code === 0 && existsSync(image)) console.log(`bun as an image: ${image}`);
  return code === 0;
}
