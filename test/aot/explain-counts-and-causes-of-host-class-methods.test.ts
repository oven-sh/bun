// A method of a host class that runs no JavaScript and is not handed its wrapper keeps nothing of its receiver, so the next
// call on the same instance is a direct call and no access is looked up by name.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function explain(text: string) {
  using dir = tempDirWithBunTypes("aot-explain-host-methods", { "main.ts": text });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=json", "main.ts"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const lines = (stdout + stderr).split("\n");
  const summary = lines.find(line => line.startsWith('{"accesses"'));
  const entries = lines.filter(line => line.startsWith('{"rank"')).map(line => JSON.parse(line));
  return {
    exitCode,
    calls: summary === undefined ? undefined : JSON.parse(summary).calls,
    accesses: summary === undefined ? undefined : JSON.parse(summary).accesses,
    reasons: entries.map(({ reason, line, column }) => `${reason} at ${line}:${column}`),
  };
}

const noAccess = { byName: 0, tested: 0, free: 0, testedSlotOnly: 0, provenWithoutAnyTest: 0 };

describe.concurrent("calls on one instance of a host class", () => {
  test("a hasher is updated and then asked for its digest: every call is proven", async () => {
    const result = await explain(`import { CryptoHasher } from "bun";
function mac(data: string): string {
  return new CryptoHasher("sha256", "k").update(data).digest("base64url");
}
console.log(mac("x"));
`);
    expect(result).toEqual({
      exitCode: 0,
      calls: { unknown: 0, guarded: 0, proven: 5 },
      accesses: noAccess,
      reasons: [],
    });
  });

  test("a getter read after a method call is one load", async () => {
    const result = await explain(`const h = new Bun.CryptoHasher("sha256");
h.update("abc");
console.log(h.byteLength);
`);
    expect(result).toEqual({
      exitCode: 0,
      calls: { unknown: 0, guarded: 0, proven: 3 },
      accesses: { ...noAccess, free: 1, provenWithoutAnyTest: 1 },
      reasons: [],
    });
  });

  test("a static hasher is updated, compared with what update answered, and asked for its digest", async () => {
    const result = await explain(`import { SHA256 } from "bun";
const sha = new SHA256();
console.log(sha.update("abc") === sha, sha.update("def").digest("base64"));
`);
    expect(result).toEqual({
      exitCode: 0,
      calls: { unknown: 0, guarded: 0, proven: 5 },
      accesses: noAccess,
      reasons: [],
    });
  });

  test("a glob matches twice", async () => {
    const result = await explain(`const g = new Bun.Glob("*.ts");
console.log(g.match("a.ts"), g.match("a.js"));
`);
    expect(result).toEqual({
      exitCode: 0,
      calls: { unknown: 0, guarded: 0, proven: 4 },
      accesses: noAccess,
      reasons: [],
    });
  });
});
