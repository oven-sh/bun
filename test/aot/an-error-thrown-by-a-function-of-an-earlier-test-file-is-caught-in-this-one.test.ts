import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

// `bun test --isolate` gives each test file a fresh realm of one VM, and each realm runs an instance of the compiled program of its own.
// `Bun.s3` is one object for the VM, so what a file hangs on it is there for the next file, in plain Bun too. A native addon that keeps a reference carries values the same way.
// Where this file calls a function of the earlier one, compiled frames of two instances stand in front of one entry into the VM. Unwinding remembered one instance for all of them,
// left the stack pointer of the handler with the earlier file's instance, and the handler of this file took its own, which was zero: a crash.
const asks = `import { test } from "bun:test";
import * as ours from "./kit.mjs";
test("throws", () => {
  const theirs = Bun.s3.kept;
  const tell = (label, run) => {
    let said;
    try { said = "returns " + run(); } catch (e) { said = "throws " + (e instanceof ours.Fault ? "our " : e instanceof theirs.Fault ? "their " : "") + (e?.name ?? typeof e) + " " + (e?.message ?? e); }
    console.log("SEEN", label, said);
  };
  if (theirs !== undefined) {
    tell("a function:", () => theirs.fail());
    tell("a number:", () => theirs.failWithNumber());
    tell("an error of the engine:", () => theirs.failInEngine());
    tell("through a finally there:", () => theirs.throughFinally());
    tell("the finally ran there:", () => [theirs.readCleanups(), ours.readCleanups()]);
    tell("a method:", () => theirs.Thrower.prototype.fail());
    tell("a getter:", () => new theirs.Thrower().member);
    tell("a static method:", () => theirs.Thrower.fail());
    tell("caught there, then ours throws:", () => { const said = theirs.caughtThere(); throw new ours.Fault("here, after " + said); });
    tell("caught there, then ours throws deeper:", () => { theirs.caughtThere(); return ours.deep(30, ours.fail); });
    tell("ours, called by theirs:", () => theirs.call(ours.fail));
    tell("ours, caught by theirs:", () => theirs.callAndCatch(ours.fail));
    tell("theirs, called by ours, called by theirs:", () => theirs.call(() => ours.call(theirs.fail)));
    tell("thrown on at each side:", () => ours.callAndThrowOn(() => theirs.callAndThrowOn(() => ours.callAndThrowOn(theirs.fail))));
    tell("deep there:", () => theirs.deep(30, theirs.fail));
    tell("deep there, ours at the end:", () => theirs.deep(30, ours.fail));
    tell("deep here, theirs at the end:", () => ours.deep(30, theirs.fail));
    tell("deep on both sides, thrown on:", () => ours.deep(10, () => theirs.callAndThrowOn(() => theirs.deep(10, () => ours.callAndThrowOn(() => ours.deep(10, theirs.fail))))));
    tell("through forEach:", () => [1].forEach(theirs.fail));
    tell("through call, apply, bind:", () => { const said = []; for (const f of [() => theirs.fail.call(), () => theirs.fail.apply(), () => Reflect.apply(theirs.fail, undefined, []), theirs.fail.bind(null)]) { try { f(); } catch (e) { said.push(e instanceof theirs.Fault); } } return said; });
    tell("through JSON.stringify:", () => JSON.stringify({ toJSON: theirs.fail }));
    tell("through sort:", () => [2, 1].sort(theirs.fail));
    tell("a generator:", () => [...theirs.steps()]);
    tell("an error made there and thrown here:", () => { let kept; try { theirs.fail(); } catch (e) { kept = e; } throw kept; });
    tell("after all that ours still works:", () => { try { ours.fail(); } catch (e) { return e instanceof ours.Fault; } });
    tell("many times:", () => { let n = 0; for (let i = 0; i < 2000; i++) { try { (i & 1 ? theirs : ours).fail(); } catch (e) { n += e instanceof theirs.Fault ? 1 : 1000; } } return n; });
  }
  Bun.s3.kept = ours;
});
`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "kit.mjs": `export class Fault extends Error { name = "Fault"; }
export let cleanups = 0;
export const fail = () => { throw new Fault("failed"); };
export const failWithNumber = () => { throw 7; };
export const failInEngine = () => null.member;
export const caughtThere = () => { try { throw new Fault("there"); } catch (e) { return e.message; } };
export function throughFinally() { try { fail(); } finally { cleanups++; } }
export const readCleanups = () => cleanups;
export class Thrower { fail() { throw new Fault("in a method"); } get member() { throw new Fault("in a getter"); } static fail() { throw new Fault("in a static method"); } }
export const call = f => f();
export const callAndCatch = f => { try { return f(); } catch (e) { return "caught there: " + e.message; } };
export const callAndThrowOn = f => { try { return f(); } catch (e) { throw e; } };
export const deep = (n, f) => (n ? deep(n - 1, f) + 0 : f());
export function* steps() { yield 1; throw new Fault("in a generator"); }
`,
  "a.test.mjs": asks,
  "b.test.mjs": asks,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const command = [bunExe(), "test", "--isolate", ...flags, "./a.test.mjs", "./b.test.mjs"];
  const { stdout, stderr, exitCode } = await run(command, directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [way, words] of [
  ["as the runner divides it", undefined],
  ["as one program", "TestRunLayers:0"],
  ["over two layers, both files in one process", "TestRunLayers:2,TestRunPartFiles:3"],
] as const) {
  test(`an error thrown by a function of an earlier test file is caught in this one, ${way}`, async () => {
    using dir = tempDir("aot-an-error-thrown-by-a-function-of-an-earlier-test-file", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: [
        "SEEN a function: throws their Fault failed",
        "SEEN a number: throws number 7",
        "SEEN an error of the engine: throws TypeError null is not an object (evaluating 'null.member')",
        "SEEN through a finally there: throws their Fault failed",
        "SEEN the finally ran there: returns 1,0",
        "SEEN a method: throws their Fault in a method",
        "SEEN a getter: throws their Fault in a getter",
        "SEEN a static method: throws their Fault in a static method",
        "SEEN caught there, then ours throws: throws our Fault here, after there",
        "SEEN caught there, then ours throws deeper: throws our Fault failed",
        "SEEN ours, called by theirs: throws our Fault failed",
        "SEEN ours, caught by theirs: returns caught there: failed",
        "SEEN theirs, called by ours, called by theirs: throws their Fault failed",
        "SEEN thrown on at each side: throws their Fault failed",
        "SEEN deep there: throws their Fault failed",
        "SEEN deep there, ours at the end: throws our Fault failed",
        "SEEN deep here, theirs at the end: throws their Fault failed",
        "SEEN deep on both sides, thrown on: throws their Fault failed",
        "SEEN through forEach: throws their Fault failed",
        "SEEN through call, apply, bind: returns true,true,true,true",
        "SEEN through JSON.stringify: throws their Fault failed",
        "SEEN through sort: throws their Fault failed",
        "SEEN a generator: throws their Fault in a generator",
        "SEEN an error made there and thrown here: throws their Fault failed",
        "SEEN after all that ours still works: returns true",
        "SEEN many times: returns 1001000",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
