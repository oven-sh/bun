// An opt-in test. ./app is a backend on Bun.serve and Bun.sql, written the way a user of Bun would write it: the six test types of
// the TechEmpower Framework Benchmarks (plaintext, JSON, one query, several queries, fortunes, updates) and a small shop in several
// modules (a route with parameters, a session, a body validated with zod, two queries, a request to another HTTP service, and
// an answer of two kilobytes). It is built with `bun build --compile --aot`, started, and asked. ./answers.ts has what is right.
//
//   AOT_BACKEND=1 bun test test/aot/backend
//   AOT_BACKEND_MODULES=<a node_modules folder> ..     the packages are already installed there, and nothing is downloaded
//   AOT_BACKEND_DATABASE_URL=postgres://.. ..          a database that ./schema.sql may fill. Its tables of the same names are dropped.
//
// Without AOT_BACKEND everything is skipped: the packages named in ./app/package.json are downloaded from npm.
// It needs Postgres. Without AOT_BACKEND_DATABASE_URL it uses the container that test/js/sql uses, and where there is no Docker
// either, everything is skipped.
//
// ./measure has the benchmark. See ./README.md.
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isDockerEnabled, isWindows, tempDir } from "harness";
import { join } from "path";
import * as dockerCompose from "../../docker/index.ts";
import { built, spawned, unsupported } from "../run-programs";
import { badOrders, carrierRates, fortunesPage, json, orders, plaintext, product, sessionToken } from "./answers";

const wanted = !!process.env.AOT_BACKEND;
const hasPostgres = wanted && (!!process.env.AOT_BACKEND_DATABASE_URL || isDockerEnabled());

async function started(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  const proc = Bun.spawn({ cmd, cwd, env: { ...env, PORT: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const errors = proc.stderr.text();
  let printed = "";
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    printed += chunk;
    const port = /^listening (\d+)$/m.exec(printed)?.[1];
    if (port) return { origin: `http://127.0.0.1:${port}`, [Symbol.dispose]: () => proc.kill("SIGKILL") };
  }
  throw new Error(`${cmd.join(" ")} ended with exit code ${await proc.exited} before it listened:\n${await errors}`);
}

interface World {
  id: number;
  randomNumber: number;
}

function expectWorld(world: World) {
  expect(Object.keys(world)).toEqual(["id", "randomNumber"]);
  for (const number of [world.id, world.randomNumber]) {
    expect(number).toBeInteger();
    expect(number).toBeWithin(1, 10001);
  }
}

if (!wanted)
  console.error(
    "SKIPPED: test/aot/backend/backend.test.ts: it installs packages from npm and wants PostgreSQL. AOT_BACKEND=1 runs it",
  );
else if (!hasPostgres)
  console.error(
    "SKIPPED: test/aot/backend/backend.test.ts: there is no PostgreSQL: neither AOT_BACKEND_DATABASE_URL nor docker",
  );

describe.skipIf(!wanted || !hasPostgres || !!unsupported)("compile/aot/backend", () => {
  const folder = String(tempDir("aot-backend", {}));
  const executable = join(folder, `server-compiled${isWindows ? ".exe" : ""}`);
  let sql: SQL;
  let env: Record<string, string | undefined>;

  const carrier = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/rates": request => {
        const query = new URL(request.url).searchParams;
        const country = query.get("country")!;
        const grams = Number(query.get("grams"));
        return Response.json({
          carrier: "Northwind Freight",
          currency: "EUR",
          country,
          grams,
          rates: carrierRates(country, grams),
        });
      },
    },
  });
  afterAll(async () => {
    await carrier.stop(true);
    await sql?.close();
  });

  const compiled = () => started([executable], folder, { ...env, BUN_JSC_crashIfInterpreterIsUsed: "1" });

  async function asked(origin: string, path: string, init?: RequestInit) {
    const response = await fetch(origin + path, init);
    return {
      status: response.status,
      type: response.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase(),
      hasDate: response.headers.has("Date"),
      body: await response.text(),
    };
  }

  const quoted = (origin: string, token: string | undefined, body: string, shop = "west") =>
    asked(origin, `/api/shops/${shop}/quotes`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });

  beforeAll(async () => {
    let url = process.env.AOT_BACKEND_DATABASE_URL;
    if (!url) {
      const info = await dockerCompose.ensure("postgres_plain");
      url = `postgres://bun_sql_test@${info.host}:${info.ports[5432]}/bun_sql_test`;
    }
    sql = new SQL({ url, max: 1 });
    await sql.unsafe(await Bun.file(join(import.meta.dir, "schema.sql")).text()).simple();
    env = { ...bunEnv, DATABASE_URL: url, CARRIER_URL: `http://127.0.0.1:${carrier.port}` };

    cpSync(join(import.meta.dir, "app"), folder, { recursive: true });
    if (process.env.AOT_BACKEND_MODULES) {
      symlinkSync(process.env.AOT_BACKEND_MODULES, join(folder, "node_modules"));
    } else {
      const install = await spawned([bunExe(), "install", "--ignore-scripts"], folder, bunEnv);
      expect({ stderr: install.stderr, exitCode: install.exitCode }).toEqual({
        stderr: expect.any(String),
        exitCode: 0,
      });
    }
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", "--target=bun", "./server.ts", "--outfile", executable],
        folder,
        bunEnv,
      ),
    );
  }, 240_000);

  test("plaintext, JSON and fortunes", async () => {
    using server = await compiled();
    expect(await asked(server.origin, "/plaintext")).toEqual({
      status: 200,
      type: "text/plain",
      hasDate: true,
      body: plaintext,
    });
    expect(await asked(server.origin, "/json")).toEqual({
      status: 200,
      type: "application/json",
      hasDate: true,
      body: json,
    });
    expect(await asked(server.origin, "/fortunes")).toEqual({
      status: 200,
      type: "text/html",
      hasDate: true,
      body: fortunesPage,
    });
    expect((await fetch(server.origin + "/json")).headers.get("Server")).toBe("Bun");
    expect((await fetch(server.origin + "/nothing")).status).toBe(404);
  });

  test("one query and several", async () => {
    using server = await compiled();
    expectWorld(await (await fetch(server.origin + "/db")).json());
    for (const [queries, count] of [
      ["", 1],
      ["foo", 1],
      ["0", 1],
      ["1", 1],
      ["5", 5],
      ["20", 20],
      ["500", 500],
      ["501", 500],
    ] as const) {
      const worlds: World[] = await (await fetch(`${server.origin}/queries?queries=${queries}`)).json();
      expect(worlds).toBeArrayOfSize(count);
      worlds.forEach(expectWorld);
      for (const world of worlds.slice(0, 5)) {
        expect(await sql`SELECT randomnumber AS "randomNumber" FROM world WHERE id = ${world.id}`).toEqual([
          { randomNumber: world.randomNumber },
        ]);
      }
    }
  });

  test("updates are written", async () => {
    using server = await compiled();
    for (const count of [1, 5, 20]) {
      const worlds: World[] = await (await fetch(`${server.origin}/updates?queries=${count}`)).json();
      expect(worlds).toBeArrayOfSize(count);
      worlds.forEach(expectWorld);
      // One id may have been drawn twice, and then either number may have been written.
      const answered = Map.groupBy(worlds, world => world.id);
      for (const [id, drawn] of answered) {
        const [row] = await sql`SELECT randomnumber AS "randomNumber" FROM world WHERE id = ${id}`;
        expect(drawn.map(world => world.randomNumber)).toContain(row.randomNumber);
      }
    }
  });

  test("the shop", async () => {
    using server = await compiled();
    expect(await asked(server.origin, "/api/shops/west/products/2")).toEqual({
      status: 200,
      type: "application/json",
      hasDate: true,
      body: JSON.stringify(product(2)),
    });
    expect((await asked(server.origin, "/api/shops/west/products/3")).status).toBe(404);
    expect((await asked(server.origin, "/api/shops/west/products/x")).status).toBe(400);
    for (const { token, request, answer } of orders) {
      expect(await quoted(server.origin, token, request)).toEqual({
        status: 200,
        type: "application/json",
        hasDate: true,
        body: answer,
      });
    }
    const { token, request } = orders[0]!;
    expect(await quoted(server.origin, undefined, request)).toMatchObject({
      status: 401,
      body: '{"error":"not signed in"}',
    });
    expect(await quoted(server.origin, "nobody", request)).toMatchObject({ status: 401 });
    expect(await quoted(server.origin, sessionToken(100), request)).toMatchObject({ status: 401 }); // It has expired.
    expect(await quoted(server.origin, token, request, "east")).toMatchObject({
      status: 422,
      body: '{"error":"no such product"}',
    });
    const answered: Record<string, number> = {};
    for (const [what, body] of Object.entries(badOrders))
      answered[what] = (await quoted(server.origin, token, body)).status;
    expect(answered).toEqual(Object.fromEntries(Object.keys(badOrders).map(what => [what, 400])));
  });

  test("answers the same after a few thousand requests", async () => {
    using server = await compiled();
    let wrong: unknown;
    await Promise.all(
      Array.from({ length: 16 }, async (_, connection) => {
        for (let n = 0; n < 200 && !wrong; n++) {
          const { token, request, answer } = orders[(connection + n) % orders.length]!;
          const quote = await quoted(server.origin, token, request);
          if (quote.status !== 200 || quote.body !== answer) wrong = quote;
          const page = await asked(server.origin, "/fortunes");
          if (page.body !== fortunesPage) wrong = page;
          const worlds: World[] = await (await fetch(server.origin + "/updates?queries=5")).json();
          if (worlds.length !== 5) wrong = worlds;
        }
      }),
    );
    expect(wrong).toBeUndefined();
  }, 120_000);

  test("plain Bun answers the same", async () => {
    using server = await started([bunExe(), "./server.ts"], folder, env);
    expect((await asked(server.origin, "/fortunes")).body).toBe(fortunesPage);
    for (const { token, request, answer } of orders)
      expect((await quoted(server.origin, token, request)).body).toBe(answer);
  });

  test("`bun run --aot` answers the same", async () => {
    using server = await started([bunExe(), "run", "--aot", "./server.ts"], folder, env);
    for (const { token, request, answer } of orders)
      expect((await quoted(server.origin, token, request)).body).toBe(answer);
    const answered: Record<string, number> = {};
    for (const [what, body] of Object.entries(badOrders))
      answered[what] = (await quoted(server.origin, orders[0]!.token, body)).status;
    expect(answered).toEqual(Object.fromEntries(Object.keys(badOrders).map(what => [what, 400])));
  });
});
