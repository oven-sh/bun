import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

// `bun test --isolate` gives each test file a fresh realm of one VM, and each realm runs an instance of the compiled program of its own.
// `Bun.s3` is one object for the VM, so what a file hangs on it is there for the next file, in plain Bun too.
// A method called on an object of the earlier file runs with that file's variables: what it throws is an instance of that file's class.
// A call whose callee never returns is resolved late, behind a test of the receiver's shape, which the objects of every instance pass. The call
// then went straight to the code with this file's instance. A method read off such an object was a closure of this file's.
const asks = `import { test } from "bun:test";
import * as ours from "./kit.mjs";
test("asks", () => {
  const theirs = Bun.s3.kept;
  const side = e => (e instanceof ours.Fault ? "ours" : e instanceof theirs.Fault ? "theirs" : "neither");
  const tell = (label, run) => {
    let said;
    try { said = "returns " + side(run()); } catch (e) { said = "throws " + side(e); }
    console.log("SEEN", label, said);
  };
  if (theirs !== undefined) {
    tell("fresh:", () => new theirs.Thrower().fail());
    tell("fresh, held:", () => { const t = new theirs.Thrower(); return t.fail(); });
    tell("fresh, in a try:", () => { try { new theirs.Thrower().fail(); } catch (e) { return e; } });
    tell("fresh, through an array:", () => { const t = [new theirs.Thrower()]; return t[0].fail(); });
    tell("fresh, under a computed key:", () => { const k = "fa" + "il".slice(0); return new theirs.Thrower()[k](); });
    tell("made there:", () => theirs.makeThrower().fail());
    tell("kept there:", () => theirs.kept.fail());
    tell("kept there, held:", () => { const t = theirs.kept; return t.fail(); });
    tell("below:", () => new theirs.Below().fail());
    tell("one that returns:", () => new theirs.Thrower().make());
    tell("one that may throw:", () => new theirs.Thrower().maybe(true));
    tell("read, then called bare:", () => { const f = new theirs.Thrower().fail; return f(); });
    tell("read, then called on it:", () => { const t = new theirs.Thrower(); const f = t.fail; return f.call(t); });
    tell("read off the kept one, then called bare:", () => { const f = theirs.kept.fail; return f(); });
    tell("one that returns, read, then called bare:", () => { const f = new theirs.Thrower().make; return f(); });
    tell("read and handed on:", () => [new theirs.Thrower().fail].map(f => { try { f(); } catch (e) { return e; } })[0]);
    tell("ours:", () => new ours.Thrower().fail());
    tell("ours, made here:", () => ours.makeThrower().fail());
    tell("either, in turn:", () => {
      let n = 0;
      for (let i = 0; i < 2000; i++) {
        try { new (i & 1 ? theirs : ours).Thrower().fail(); } catch (e) { n += e instanceof theirs.Fault ? 1 : 1000; }
      }
      if (n !== 1001000) throw new Error("counted " + n);
      return new theirs.Fault("counted");
    });
  }
  Bun.s3.kept = ours;
});
`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "kit.mjs": `export class Fault extends Error { name = "Fault"; }
export class Thrower {
  fail() { throw new Fault("in a method"); }
  make() { return new Fault("made"); }
  maybe(x) { if (x) throw new Fault("maybe"); return undefined; }
}
export class Below extends Thrower {}
export const makeThrower = () => new Thrower();
export const kept = new Thrower();
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
  test(`a method called on an object of an earlier test file runs in its own realm, ${way}`, async () => {
    using dir = tempDir("aot-a-method-called-on-an-object-of-an-earlier-test-file", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: [
        "SEEN fresh: throws theirs",
        "SEEN fresh, held: throws theirs",
        "SEEN fresh, in a try: returns theirs",
        "SEEN fresh, through an array: throws theirs",
        "SEEN fresh, under a computed key: throws theirs",
        "SEEN made there: throws theirs",
        "SEEN kept there: throws theirs",
        "SEEN kept there, held: throws theirs",
        "SEEN below: throws theirs",
        "SEEN one that returns: returns theirs",
        "SEEN one that may throw: throws theirs",
        "SEEN read, then called bare: throws theirs",
        "SEEN read, then called on it: throws theirs",
        "SEEN read off the kept one, then called bare: throws theirs",
        "SEEN one that returns, read, then called bare: returns theirs",
        "SEEN read and handed on: returns theirs",
        "SEEN ours: throws ours",
        "SEEN ours, made here: throws ours",
        "SEEN either, in turn: returns theirs",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  });
}
