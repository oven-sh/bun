import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    import { EventEmitter } from "node:events";
    import { Duplex, PassThrough, Readable, Stream, Transform, Writable } from "node:stream";
    const rounds = Number(process.argv[2]);
    const makers = {
      EventEmitter: () => new EventEmitter(),
      Stream: () => new Stream(),
      Readable: () => new Readable({ read() {} }),
      Writable: () => new Writable({ write(chunk, encoding, callback) { callback(); } }),
      Duplex: () => new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } }),
      Transform: () => new Transform({ transform(chunk, encoding, callback) { callback(null, chunk); } }),
      PassThrough: () => new PassThrough(),
    };
    let listeners = 0;
    for (const name of Object.keys(makers)) {
      const make = makers[name];
      for (let round = 0; round < rounds; round++) listeners += make().listenerCount("data");
    }
    Bun.gc(true);
    console.log(Object.keys(makers).join(), listeners);
  `,
};

const operations = [
  "operationAOTPutByIdAndCache",
  "operationAOTGetByIdAndCache",
  "operationAOTPutByValAndCache",
  "operationAOTGetByValAndCache",
  "operationAOTPutById",
  "operationAOTGetById",
];

test("making an EventEmitter or a stream stops asking the run time for its properties", async () => {
  using dir = tempDir("aot-constructors-of-builtin-modules", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const counted = async (rounds: number) => {
    const path = join(String(dir), "counts" + rounds);
    const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: "EventEmitter,Stream,Readable,Writable,Duplex,Transform,PassThrough 0\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(operations.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  const more = Object.fromEntries(
    operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
}, 240_000);
