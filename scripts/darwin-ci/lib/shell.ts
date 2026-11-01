export function log(message: string): void {
  console.log(`${new Date().toTimeString().slice(0, 8)} ${message}`);
}

export function step(title: string): void {
  console.log(`\n=== ${title}`);
}

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

export const sleep = (ms: number) => Bun.sleep(ms);

export const shellQuote = (arg: string) => `'${arg.replace(/'/g, `'\\''`)}'`;

export type Result = { exitCode: number; stdout: string; stderr: string };
export type SpawnOptions = {
  cwd?: string;
  stdin?: string | Uint8Array<ArrayBuffer>;
  env?: Record<string, string | undefined>;
};

// Bun.spawn throws ENOENT for a missing executable; report it the way a shell does, as exit 127, so a probe of a
// tool that is not installed yet (buildkite-agent on a fresh host) is an answer and not a crash
const notFound = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export async function spawn(argv: string[], { stdin, ...where }: SpawnOptions = {}): Promise<Result> {
  let proc;
  try {
    proc = Bun.spawn(argv, {
      ...where,
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    if (notFound(error)) return { exitCode: 127, stdout: "", stderr: `${argv[0]}: not found` };
    throw error;
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

// only the leading words: argv may carry a password further along
const describe = (argv: string[]) => argv.slice(0, 3).join(" ");

export async function run(argv: string[], options?: SpawnOptions): Promise<string> {
  const { exitCode, stdout, stderr } = await spawn(argv, options);
  if (exitCode !== 0) throw new Error(`${describe(argv)} exited ${exitCode}\n${stderr}`.trimEnd());
  return stdout;
}

// stdio passed through, for long-running commands whose progress the operator wants to see
export async function runInherit(argv: string[], where: Omit<SpawnOptions, "stdin"> = {}): Promise<number> {
  try {
    return await Bun.spawn(argv, { ...where, stdin: "ignore", stdout: "inherit", stderr: "inherit" }).exited;
  } catch (error) {
    if (!notFound(error)) throw error;
    console.error(`${argv[0]}: not found`);
    return 127;
  }
}

export async function runInheritOrThrow(argv: string[], options?: Omit<SpawnOptions, "stdin">): Promise<void> {
  const exitCode = await runInherit(argv, options);
  if (exitCode !== 0) throw new Error(`${describe(argv)} exited ${exitCode}`);
}

export const output = async (argv: string[]) => (await run(argv)).trim();

// for commands whose failure is an expected answer (a probe of something that may not exist yet)
export async function probe(argv: string[]): Promise<string | undefined> {
  const { exitCode, stdout } = await spawn(argv);
  return exitCode === 0 ? stdout.trim() || undefined : undefined;
}

export const succeeds = async (argv: string[]) => (await spawn(argv)).exitCode === 0;

export async function poll<T>(
  attempts: number,
  intervalMs: number,
  check: () => Promise<T | undefined>,
): Promise<T | undefined> {
  for (let i = 0; i < attempts; i++) {
    const value = await check();
    if (value !== undefined) return value;
    await sleep(intervalMs);
  }
  return undefined;
}

export const portOpen = (host: string, port: number) => succeeds(["nc", "-z", "-w2", host, String(port)]);

export async function sudoWrite(
  path: string,
  content: string | Uint8Array<ArrayBuffer>,
  mode = "644",
  owner = "root:wheel",
): Promise<void> {
  // created 0600 (umask 077), so a token is never readable by others before the chmod below
  await run(["sudo", "/bin/sh", "-c", 'umask 077 && exec tee "$1" >/dev/null', "sh", path], { stdin: content });
  await run(["sudo", "chown", owner, path]);
  await run(["sudo", "chmod", mode, path]);
}

export const sudoRead = (path: string) => probe(["sudo", "cat", path]);

export async function consoleUser(): Promise<string | undefined> {
  const user = await probe(["stat", "-f", "%Su", "/dev/console"]);
  return user !== "root" ? user : undefined;
}
