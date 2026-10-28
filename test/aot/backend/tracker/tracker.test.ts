// An opt-in test. ./app is an issue tracker on Bun.serve and Bun.sql: see ./README.md. It is built with `bun build --compile --aot`
// and started. The same sources run without --aot. Both get every request of ./exchanges.ts, each on a
// copy of the database of its own, and must answer alike to the byte.
//
//   AOT_TRACKER_DATABASE_URL=postgres://.. bun test test/aot/backend/tracker
//       a database that ./schema.sql may fill, of a role that may create databases. Its tables of the same names are dropped.
//   AOT_TRACKER_MODULES=<a node_modules folder> ..     @types/bun is already installed there, and nothing is downloaded
//   AOT_TRACKER_RIVALS="go=<executable> rust=<executable>" ..     ./rivals/go and ./rivals/rust, already built, are compared too
//
// Without AOT_TRACKER_DATABASE_URL everything is skipped.
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, unsupported } from "../../run-programs";
import { difference, makeExchanges, send, type Exchange } from "./exchanges";

const databaseUrl = process.env.AOT_TRACKER_DATABASE_URL;

async function started(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  const proc = Bun.spawn({ cmd, cwd, env: { ...env, PORT: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const errors = proc.stderr.text();
  let printed = "";
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    printed += chunk;
    const port = /^listening (\d+)$/m.exec(printed)?.[1];
    if (port) return { port: Number(port), stop: () => proc.kill("SIGKILL") };
  }
  throw new Error(`${cmd.join(" ")} ended with exit code ${await proc.exited} before it listened:\n${await errors}`);
}

if (!databaseUrl)
  console.error(
    "SKIPPED: test/aot/backend/tracker/tracker.test.ts: it wants PostgreSQL. AOT_TRACKER_DATABASE_URL=postgres://.. runs it",
  );

describe.skipIf(!databaseUrl || !!unsupported)("compile/aot/backend/tracker", () => {
  const servers: { name: string; port: number; stop(): void }[] = [];
  const copies: string[] = [];
  let exchanges: Exchange[] = [];
  let sql: SQL;

  async function install(folder: string) {
    if (process.env.AOT_TRACKER_MODULES)
      return symlinkSync(process.env.AOT_TRACKER_MODULES, join(folder, "node_modules"));
    const install = await spawned([bunExe(), "install", "--ignore-scripts"], folder, bunEnv);
    expect({ stderr: install.stderr, exitCode: install.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  }

  async function start(name: string, cmd: string[], cwd: string, more: Record<string, string> = {}) {
    const copy = `tracker_copy_${name}`;
    await sql.unsafe(`DROP DATABASE IF EXISTS ${copy}`);
    await sql.unsafe(`CREATE DATABASE ${copy} TEMPLATE ${new URL(databaseUrl!).pathname.slice(1)}`);
    copies.push(copy);
    const url = new URL(databaseUrl!);
    url.pathname = `/${copy}`;
    servers.push({
      name,
      ...(await started(cmd, cwd, { ...bunEnv, ...more, DATABASE_URL: String(url), DATABASE_POOL: "4" })),
    });
  }

  beforeAll(async () => {
    const filled = new SQL({ url: databaseUrl!, max: 1 });
    await filled.unsafe(await Bun.file(join(import.meta.dir, "schema.sql")).text()).simple();
    exchanges = await makeExchanges(filled);
    await filled.close();

    const elsewhere = new URL(databaseUrl!);
    elsewhere.pathname = "/postgres";
    sql = new SQL({ url: String(elsewhere), max: 1 });

    const folder = String(tempDir("aot-tracker", {}));
    cpSync(join(import.meta.dir, "app"), folder, { recursive: true });
    await install(folder);
    await start("plain", [bunExe(), "server.ts"], folder);

    const executable = join(folder, `server-compiled${isWindows ? ".exe" : ""}`);
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", "--target=bun", "./server.ts", "--outfile", executable],
        folder,
        bunEnv,
      ),
    );
    await start("aot", [executable], folder, { BUN_JSC_crashIfInterpreterIsUsed: "1" });

    for (const rival of (process.env.AOT_TRACKER_RIVALS ?? "").split(" ").filter(Boolean)) {
      const [name, path] = rival.split("=") as [string, string];
      await start(name, [path], folder);
    }
  }, 600_000);

  afterAll(async () => {
    for (const server of servers) server.stop();
    for (const copy of copies) await sql.unsafe(`DROP DATABASE IF EXISTS ${copy} WITH (FORCE)`);
    await sql?.close();
  });

  test("every server answers every request alike", async () => {
    const parted: string[] = [];
    for (const exchange of exchanges) {
      const [first, ...others] = await Promise.all(servers.map(server => send(server.port, exchange)));
      others.forEach((other, index) => {
        const where = difference(first!, other);
        if (where !== null)
          parted.push(
            `${servers[0]!.name} | ${servers[index + 1]!.name}: ${exchange.method} ${exchange.path}: ${where}`,
          );
      });
    }
    expect(parted.slice(0, 10)).toEqual([]);
    expect(exchanges.length).toBeGreaterThan(3000);
  }, 600_000);

  test("what is asked for is there", async () => {
    const statuses = new Map<string, number>();
    for (const exchange of exchanges.filter(exchange => !["edge", "writes"].includes(exchange.set))) {
      const { status } = await send(servers[1]!.port, exchange);
      statuses.set(`${exchange.set} ${status}`, (statuses.get(`${exchange.set} ${status}`) ?? 0) + 1);
    }
    expect([...statuses.keys()].filter(key => !/ (200|201|303)$/.test(key))).toEqual([]);
  }, 600_000);
});
