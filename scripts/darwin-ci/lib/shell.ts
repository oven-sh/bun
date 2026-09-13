import { $ } from "bun";

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

export async function succeeds(proc: $.ShellPromise): Promise<boolean> {
  return (await proc.quiet().nothrow()).exitCode === 0;
}

export async function output(proc: $.ShellPromise): Promise<string> {
  return (await proc.quiet().nothrow().text()).trim();
}

export async function poll<T>(
  attempts: number,
  intervalMs: number,
  probe: () => Promise<T | undefined>,
): Promise<T | undefined> {
  for (let i = 0; i < attempts; i++) {
    const value = await probe();
    if (value !== undefined) return value;
    await sleep(intervalMs);
  }
  return undefined;
}

export function portOpen(host: string, port: number): Promise<boolean> {
  return succeeds($`nc -z -w2 ${host} ${port}`);
}

export async function sudoWrite(
  path: string,
  content: string | Uint8Array,
  mode = "644",
  owner = "root:wheel",
): Promise<void> {
  await $`sudo tee ${path} < ${new Response(content)}`.quiet();
  await $`sudo chown ${owner} ${path}`.quiet();
  await $`sudo chmod ${mode} ${path}`.quiet();
}

export async function sudoRead(path: string): Promise<string | undefined> {
  return (await output($`sudo cat ${path}`)) || undefined;
}

export async function consoleUser(): Promise<string | undefined> {
  const user = await output($`stat -f %Su /dev/console`);
  return user && user !== "root" ? user : undefined;
}
