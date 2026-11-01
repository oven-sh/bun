import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { testOneByOne as test } from "./supported";

// `bun test --isolate` gives each test file a fresh realm of one VM, and each realm runs an instance of the compiled program of its own.
// `Bun.s3` is one object for the VM, so what a file hangs on it is there for the next file, in plain Bun too.
// The closure of a function that is only ever called is made when it is first asked for. Whoever asked made it a closure of the file that was running,
// so an arrow function in a field of an object of the earlier file counted in this file's variable and threw this file's class.
const asks = `import { test } from "bun:test";
import * as ours from "./kit.mjs";
test("asks", () => {
  const theirs = Bun.s3.keptFields;
  const side = f => (f === ours.Fault ? "ours" : f === theirs.Fault ? "theirs" : f instanceof ours.Fault ? "an instance of ours" : f instanceof theirs.Fault ? "an instance of theirs" : f instanceof ours.ThePromise ? "a promise of ours" : f instanceof theirs.ThePromise ? "a promise of theirs" : Array.isArray(f) ? f.map(side).join() : String(f));
  const tell = (label, run) => { let said; try { said = "returns " + side(run()); } catch (e) { said = "throws " + side(e); } console.log("SEEN", label, said); };
  if (theirs !== undefined) {
    tell("what a fresh one is:", () => { const h = new theirs.Holder(); return [h instanceof theirs.Holder, h instanceof ours.Holder, Object.getPrototypeOf(h) === theirs.Holder.prototype, h.constructor === theirs.Holder].join(); });
    for (const [where, get] of [["kept", () => theirs.kept], ["fresh", () => new theirs.Holder()], ["made there", () => theirs.make()], ["below", () => new theirs.Below()], ["reflected", () => Reflect.construct(theirs.Holder, [])]]) {
      tell(where + ", which:", () => get().which());
      tell(where + ", fail:", () => get().fail());
      tell(where + ", only:", () => get().only());
      tell(where + ", later:", () => get().later());
      tell(where + ", both:", () => get().both());
      tell(where + ", bump:", () => { const before = [theirs.readCount(), ours.readCount()]; get().bump(); return [theirs.readCount() - before[0], ours.readCount() - before[1]].join(); });
    }
    tell("written out, kept, only:", () => theirs.kept.only());
    tell("written out, fresh, only:", () => new theirs.Holder().only());
    tell("written out, made there, only:", () => theirs.make().only());
    tell("written out, fresh, fail:", () => new theirs.Holder().fail());
    tell("written out, made there, fail:", () => theirs.make().fail());
    tell("written out, fresh, later:", () => new theirs.Holder().later());
    tell("written out, fresh, both:", () => new theirs.Holder().both());
    tell("read then called:", () => { const f = new theirs.Holder().which; return f(); });
    tell("spread:", () => ({ ...new theirs.Holder() }).spread());
    tell("assigned:", () => Object.assign({}, new theirs.Holder()).assigned());
    tell("call:", () => new theirs.Holder().viaCall.call(null));
    tell("apply:", () => new theirs.Holder().viaApply.apply(null, []));
    tell("optional:", () => new theirs.Holder().optional?.());
    tell("by a name put together:", () => new theirs.Holder()["by" + "Name"]());
    tell("destructured:", () => { const { destructured } = new theirs.Holder(); return destructured(); });
    tell("values:", () => Object.values(new theirs.Holder()).filter(f => typeof f === "function" && f.name === "only")[0]());
    tell("read in a loop:", () => { let n = 0; for (let i = 0; i < 3000; i++) { const f = theirs.make().looped; n += f() === theirs.Fault ? 1 : 1000; } return n; });
    tell("called in a loop:", () => { let n = 0; for (let i = 0; i < 3000; i++) n += theirs.make().looped() === theirs.Fault ? 1 : 1000; return n; });
    tell("fresh in a loop:", () => { let n = 0; for (let i = 0; i < 3000; i++) n += new theirs.Holder().looped() === theirs.Fault ? 1 : 1000; return n; });
    tell("either in a loop:", () => { let n = 0; for (let i = 0; i < 3000; i++) n += new (i & 1 ? theirs : ours).Holder().looped() === (i & 1 ? theirs : ours).Fault ? 1 : 1000; return n; });
    tell("either made in a loop:", () => { let n = 0; for (let i = 0; i < 3000; i++) n += (i & 1 ? theirs : ours).make().looped() === (i & 1 ? theirs : ours).Fault ? 1 : 1000; return n; });
    tell("ours first, then theirs:", () => { const ask = h => h.looped(); let n = 0; for (let i = 0; i < 3000; i++) n += ask(new ours.Holder()) === ours.Fault ? 0 : 1000; return [n, ask(new theirs.Holder()), ask(theirs.make()), ask(theirs.kept)]; });
    tell("an environment, fresh:", () => { const before = [theirs.readCount(), ours.readCount()]; new theirs.WithEnvironment(5).add(); return [theirs.readCount() - before[0], ours.readCount() - before[1]].join(); });
    tell("an environment, made there:", () => { const before = [theirs.readCount(), ours.readCount()]; theirs.makeWith(5).add(); return [theirs.readCount() - before[0], ours.readCount() - before[1]].join(); });
    tell("an environment, what:", () => new theirs.WithEnvironment(7).what());
    tell("a literal:", () => theirs.literal().run());
    tell("a literal, bump:", () => { const before = [theirs.readCount(), ours.readCount()]; theirs.literal().bump(); return [theirs.readCount() - before[0], ours.readCount() - before[1]].join(); });
    tell("ours:", () => new ours.Holder().only());
  }
  Bun.s3.keptFields = ours;
});
`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "kit.mjs": `export class Fault extends Error { name = "Fault"; }
export let count = 0;
export const ThePromise = Promise;
export class Holder {
  tag = "holder";
  which = () => Fault;
  fail = () => { throw new Fault("in a field"); };
  bump = () => ++count;
  later = async () => Fault;
  both = () => [this.tag, Fault];
  only = () => Fault;
  spread = () => Fault;
  assigned = () => Fault;
  looped = () => Fault;
  viaCall = () => Fault;
  viaApply = () => Fault;
  optional = () => Fault;
  byName = () => Fault;
  destructured = () => Fault;
}
export class Below extends Holder { more = () => Fault; }
export class WithEnvironment {
  constructor(step) {
    this.add = () => (count += step);
    this.what = () => [step, Fault];
  }
}
export const literal = () => ({ run: () => Fault, bump: () => ++count });
export const kept = new Holder();
export const make = () => new Holder();
export const makeWith = step => new WithEnvironment(step);
export const readCount = () => count;
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
  test(`a function in a field of an object of an earlier test file runs in its own realm, ${way}`, async () => {
    using dir = tempDir("aot-a-function-in-a-field-of-an-object-of-an-earlier-test-file", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: [
        "SEEN what a fresh one is: returns true,false,true,true",
        "SEEN kept, which: returns theirs",
        "SEEN kept, fail: throws an instance of theirs",
        "SEEN kept, only: returns theirs",
        "SEEN kept, later: returns a promise of theirs",
        "SEEN kept, both: returns holder,theirs",
        "SEEN kept, bump: returns 1,0",
        "SEEN fresh, which: returns theirs",
        "SEEN fresh, fail: throws an instance of theirs",
        "SEEN fresh, only: returns theirs",
        "SEEN fresh, later: returns a promise of theirs",
        "SEEN fresh, both: returns holder,theirs",
        "SEEN fresh, bump: returns 1,0",
        "SEEN made there, which: returns theirs",
        "SEEN made there, fail: throws an instance of theirs",
        "SEEN made there, only: returns theirs",
        "SEEN made there, later: returns a promise of theirs",
        "SEEN made there, both: returns holder,theirs",
        "SEEN made there, bump: returns 1,0",
        "SEEN below, which: returns theirs",
        "SEEN below, fail: throws an instance of theirs",
        "SEEN below, only: returns theirs",
        "SEEN below, later: returns a promise of theirs",
        "SEEN below, both: returns holder,theirs",
        "SEEN below, bump: returns 1,0",
        "SEEN reflected, which: returns theirs",
        "SEEN reflected, fail: throws an instance of theirs",
        "SEEN reflected, only: returns theirs",
        "SEEN reflected, later: returns a promise of theirs",
        "SEEN reflected, both: returns holder,theirs",
        "SEEN reflected, bump: returns 1,0",
        "SEEN written out, kept, only: returns theirs",
        "SEEN written out, fresh, only: returns theirs",
        "SEEN written out, made there, only: returns theirs",
        "SEEN written out, fresh, fail: throws an instance of theirs",
        "SEEN written out, made there, fail: throws an instance of theirs",
        "SEEN written out, fresh, later: returns a promise of theirs",
        "SEEN written out, fresh, both: returns holder,theirs",
        "SEEN read then called: returns theirs",
        "SEEN spread: returns theirs",
        "SEEN assigned: returns theirs",
        "SEEN call: returns theirs",
        "SEEN apply: returns theirs",
        "SEEN optional: returns theirs",
        "SEEN by a name put together: returns theirs",
        "SEEN destructured: returns theirs",
        "SEEN values: returns theirs",
        "SEEN read in a loop: returns 3000",
        "SEEN called in a loop: returns 3000",
        "SEEN fresh in a loop: returns 3000",
        "SEEN either in a loop: returns 3000",
        "SEEN either made in a loop: returns 3000",
        "SEEN ours first, then theirs: returns 0,theirs,theirs,theirs",
        "SEEN an environment, fresh: returns 5,0",
        "SEEN an environment, made there: returns 5,0",
        "SEEN an environment, what: returns 7,theirs",
        "SEEN a literal: returns theirs",
        "SEEN a literal, bump: returns 1,0",
        "SEEN ours: returns ours",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  });
}
