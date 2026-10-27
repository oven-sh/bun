// The compiler follows every value of a program from where it is made to where it is used. What stands behind an operation for which it finds no value is unreachable to it.
// That is right where the operation never completes: a call of what always throws or is no function, a read from null. The compiler knows those reasons.
// Where every operand of an operation has a value, its result has none and no such reason holds, a value has been lost. A build that verifies the program, as every build of
// these tests does, stops there: an internal error that names the operation, the function, the file and the line.
//
// `--aot-sabotage=StoredValuesAreNeverRead` (hidden) loses values on purpose: a read no longer finds what was stored.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registry } from "./harness/registry";
import { slot, spawned, unsupported } from "./run-programs";
import { describe, test } from "./supported";

const losesValues = "--aot-sabotage=StoredValuesAreNeverRead";

const stopped: Record<string, { source: string; place: string }> = {
  "a read of a field in a function": {
    source: `
type Pair = { left: number; right: string };
function leftOf(pair: Pair): number {
  const left = pair.left;
  return left + 1;
}
console.log(leftOf({ left: 1, right: "two" }));`,
    place: String.raw`\(PropGet\) in function 'leftOf' at .*main\.ts:4:\d+`,
  },
};

// Each has values for all its operands and none for its result, and a reason why it never completes.
const built: Record<string, string> = {
  "a call of what always throws, and what stands behind it": `
function fail(text: string): never { throw new Error(text); }
function run(): number { const pair = { left: fail("no") }; return pair.left; }
try { run(); } catch (e) { console.log((e as Error).message); }`,
  "a call of what is not there": `
const o: any = {};
function call() { return o.absent(); }
try { call(); } catch (e) { console.log((e as Error).name); }`,
  "a read from null": `
const nothing: any = null;
function read() { return nothing.name; }
try { read(); } catch (e) { console.log((e as Error).name); }`,
  "a class called without new, and an arrow function constructed": `
class Made {}
const arrow: any = () => 1;
function call() { return (Made as any)(); }
function construct() { return new arrow(); }
for (const f of [call, construct]) try { f(); } catch (e) { console.log((e as Error).name); }`,
  "a getter that always throws": `
const o = { get poison(): number { throw new Error("poison"); } };
function read() { return o.poison; }
try { read(); } catch (e) { console.log((e as Error).message); }`,
  "a loop over what is not iterable, a private name on what lacks it, a symbol added to a number": `
class Holder { #held = 1; static heldBy(o: any) { return o.#held; } }
const cases = [() => { for (const x of undefined as any) console.log(x); }, () => Holder.heldBy({}), () => (Symbol() as any) + 1];
for (const f of cases) try { f(); } catch (e) { console.log((e as Error).name); }`,
};

async function build(source: string, ...flags: string[]) {
  using folder = tempDir("aot-an-operation-without-a-value", { "main.ts": source });
  const executable = join(String(folder), "main");
  const result = await slot(() =>
    spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./main.ts", "--outfile", executable],
      String(folder),
      bunEnv,
    ),
  );
  return { exitCode: result.exitCode, stderr: result.stderr, isThere: existsSync(executable) };
}

const hasTheWord = !unsupported && registry().sabotages?.includes("StoredValuesAreNeverRead");

describe.skipIf(!hasTheWord)("compile/aot/an operation without a value stops the build", () => {
  test.concurrent.each(Object.keys(stopped))("is named: %s", async name => {
    const { source, place } = stopped[name];
    const result = await build(source, losesValues);
    expect(result.stderr).toMatch(
      new RegExp(`internal compiler error \\(AnalyzeFlow\\): OperationWithoutValue: .*${place}`),
    );
    expect(result.stderr).toContain("This is a bug in Bun. Please report it");
    expect({ exitCode: result.exitCode, isThere: result.isThere }).toEqual({ exitCode: 1, isThere: false });
    expect(await build(source)).toMatchObject({ exitCode: 0, isThere: true });
  });
});

describe("compile/aot/an operation that never completes has no value", () => {
  test.concurrent.each(Object.keys(built))("is built: %s", async name => {
    const result = await build(built[name]);
    expect(result.stderr).not.toContain("internal compiler error");
    expect({ exitCode: result.exitCode, isThere: result.isThere }).toEqual({ exitCode: 0, isThere: true });
  });
});
