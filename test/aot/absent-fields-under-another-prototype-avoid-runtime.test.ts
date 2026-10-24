import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.ts": `
    declare const process: { argv: string[] };
    declare const console: { log(...values: any[]): void };
    interface Fields { a: number; b: any; count?: any; ended?: any; size?: number; flag?: boolean; late?: any }
    function Upper(this: any) {}
    Upper.prototype.count = 0;
    function Shared(this: any) {}
    Object.setPrototypeOf(Shared.prototype, Upper.prototype);
    Shared.prototype.ended = false;
    Shared.prototype.flag = true;
    Shared.prototype.hello = function () { return 1; };
    const shared: any = Shared.prototype;
    function make(i: number): Fields {
      const record: Fields = { a: i, b: null };
      Object.setPrototypeOf(record, shared);
      return record;
    }
    function readCount(record: Fields): any { return record.count; }
    function readEnded(record: Fields): any { return record.ended; }
    function readSize(record: Fields): number | undefined { return record.size; }
    function readFlag(record: Fields): boolean | undefined { return record.flag; }
    function readLate(record: Fields): any { return record.late; }
    function end(record: Fields) { record.ended = true; }
    function bump(record: Fields) { record.count++; }
    function setSize(record: Fields, size: number) { record.size = size; }
    function setLate(record: Fields, late: any) { record.late = late; }
    const rounds = Number(process.argv[2]);
    let total = 0;
    for (let round = 0; round < rounds; round++) {
      const record = make(round);
      if (readCount(record) === 0 && readEnded(record) === false && readSize(record) === undefined && readFlag(record) === true && readLate(record) === undefined) total++;
      bump(record); end(record); setSize(record, round); setLate(record, round);
      if (readCount(record) === 1 && readEnded(record) === true && readSize(record) === round && readLate(record) === round && Object.keys(record).join() === "a,b,count,ended,size,late") total++;
    }
    console.log(total === 2 * rounds);
  `,
};

const reads = ["operationAOTGetById", "operationAOTGetByIdAndCache"];
const stores = [
  "operationAOTPutById",
  "operationAOTPutByIdAndCache",
  "operationAOTDidCreateField",
  "operationAOTDidCreateFieldAt",
  "operationAOTDidCreateFieldOutOfLineAt",
  "operationAOTDidCreateFieldsAt",
];
const operations = [...reads, ...stores];

test("optional fields that are absent at birth stop asking the run time under a prototype of ordinary objects", async () => {
  using dir = tempDir("aot-absent-fields-under-another-prototype", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counted = async (rounds: number) => {
    const path = join(String(dir), "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: "true\n",
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
  // The first read and the first store miss their caches, so each list counts at least one call. A renamed operation would count none.
  expect({ reads: reads.some(name => few[name]! > 0), stores: stores.some(name => few[name]! > 0) }).toEqual({
    reads: true,
    stores: true,
  });
  const more = Object.fromEntries(
    operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
}, 240_000);
