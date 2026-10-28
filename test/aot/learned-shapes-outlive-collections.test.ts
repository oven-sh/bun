import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withoutCollections } from "./harness/counted-run";
import { runtimeEnvironment } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported-with-counted-calls";

// What a server does to the object of each request: another prototype, then some properties that its class does not have.
// Between two requests no such object is alive, and a full collection may come just then.
const files = {
  "main.ts": `
    declare const Bun: { gc(force: boolean): void };
    declare const process: { argv: string[] };
    declare const console: { log(...values: unknown[]): void };
    class Message {
      url: string;
      constructor(url: string) { this.url = url; }
      size() { return this.url.length; }
    }
    const extended: any = Object.create(Message.prototype);
    extended.helper = function () { return 1; };
    function handle(i: number): number {
      const message: any = new Message("/" + (i & 7));
      Object.setPrototypeOf(message, extended);
      message.params = i;
      message.query = "q";
      message.body = null;
      message.route = "route";
      message.next = handle;
      const headers: any = {};
      headers.host = "localhost";
      headers.accept = "*/*";
      headers.size = String(10 + (i & 127));
      return headers.size.length + message.params + message.query.length + message.helper() + message.size() + (message.body === null ? 1 : 0) + message.route.length + headers.host.length + headers.accept.length;
    }
    const collections = Number(process.argv[2]);
    let sum = 0;
    for (let round = 0; round < 40; round++) {
      for (let i = 0; i < 300; i++) sum += handle(i);
      if (round >= 10 && round < 10 + collections) Bun.gc(true);
    }
    console.log(sum);
    export {};
  `,
};

const collections = 20;

async function measure() {
  using dir = tempDir("aot-learned-shapes", files);
  const cwd = String(dir);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  built(await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv));
  const run = async (collections: number) => {
    const path = join(cwd, "counts-" + collections);
    const ran = await spawned([executable, String(collections)], cwd, {
      ...bunEnv,
      ...withoutCollections,
      [runtimeEnvironment.countsPath]: path,
    });
    const counts = new Map(
      readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => line.split("\t"))
        .map(([count, name]) => [name, Number(count)] as const),
    );
    return { stdout: ran.stdout, exitCode: ran.exitCode, of: (name: string) => counts.get(name) ?? 0 };
  };
  return { none: await run(0), many: await run(collections) };
}

describe("compile/aot/learned-shapes-outlive-collections", () => {
  let runs: Awaited<ReturnType<typeof measure>>;
  beforeAll(async () => {
    runs = await measure();
  }, 240_000);

  test("collections do not change the answer", () => {
    expect({ stdout: runs.many.stdout, exitCode: runs.many.exitCode }).toEqual({
      stdout: runs.none.stdout,
      exitCode: 0,
    });
  });

  // The shape of the messages, the places of what is read from them, and the strings of small numbers.
  test.each([
    "counter:CompiledStructuresMade",
    "operation:operationAOTGetByIdAndCache",
    "operation:operationAOTIntToString",
  ])("%s is the same with twenty full collections as with none", name => {
    expect(runs.none.of(name)).toBeGreaterThan(0);
    expect({ name, count: runs.many.of(name) }).toEqual({ name, count: runs.none.of(name) });
  });

  test("at most one store goes the long way behind a collection", () => {
    const name = "operation:operationAOTPutByIdAndCache";
    expect(runs.many.of(name) - runs.none.of(name)).toBeLessThanOrEqual(collections);
  });
});
