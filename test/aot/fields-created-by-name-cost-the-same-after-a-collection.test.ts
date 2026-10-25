import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { measureCommand } from "./analysis-scaling/measure-check";
import { test } from "./supported";

// A store by name that creates a field of an instance of a class asks a filter by the Structure whether anything above the instance stops it. Only a miss of the lookup tables fills the filter,
// and a pair that has its slot there misses no more. So a collection must leave the filters filled, or every later store takes the long way.
// Both runs collect twice, allocate the same and store the same. They differ in whether the second collection comes before or behind the stores that fill the filter.
const files = {
  "main.js": `
    // A name that the compiler cannot tell.
    const shelfKey = process.env.SHELF || "shelf";
    const shelf = globalThis;
    function hide(x) { shelf[shelfKey] = x; return shelf[shelfKey]; }
    // Objects of many kinds have the name: instances of classes and of constructor functions, and literals. The stores below have one guard for all of them, and only the classes are ever stored to:
    // the guard stays clear and the stores go by name.
    class A { constructor(a) { this.a = a; } }
    class B { constructor(a) { this.a = a; this.x = 1; } }
    class C { constructor(a) { this.a = a; this.y = 2; this.z = 3; } }
    class D { constructor(a) { this.w = 0; this.a = a; } }
    function make(i) { switch (i & 3) { case 0: return new A(i); case 1: return new B(i); case 2: return new C(i); default: return new D(i); } }
    function S(a) { this.a = a; }
    function T(a) { this.a = a; this.x = 1; }
    function U(a) { this.y = 2; this.a = a; }
    function V(a) { this.a = a; this.y = 2; this.z = 3; }
    function makeConstructed(i) { switch (i & 3) { case 0: return new S(i); case 1: return new T(i); case 2: return new U(i); default: return new V(i); } }
    function makeLiteral(i) { switch (i & 3) { case 0: return { a: i }; case 1: return { a: i, x: 1 }; case 2: return { a: i, y: 2, z: 3 }; default: return { w: 0, a: i }; } }
    // The compiler sees these stores, so the name is a field of the layouts. It does not see what the stores below land on.
    function seed(maker) { let sum = 0; for (let i = 0; i < 4; i++) { const o = maker(i); o.late = i; sum += o.late; hide(maker(i)); } return sum; }
    seed(make);
    if (process.argv[4] === "all") { seed(makeConstructed); seed(makeLiteral); }
    function store(o, v) { o.late = v; }
    const rounds = Number(process.argv[2]), collectsLast = process.argv[3] === "last", warm = 4096;
    const list = [];
    for (let i = 0; i < rounds + warm; i++) list.push(hide(make(i)));
    Bun.gc(true);
    if (!collectsLast) Bun.gc(true);
    for (let i = rounds; i < rounds + warm; i++) store(list[i], i);
    if (collectsLast) Bun.gc(true);
    for (let i = 0; i < rounds; i++) store(list[i], i);
    let sum = 0;
    for (let i = 0; i < list.length; i++) sum += list[i].late - i;
    console.log(sum);
  `,
};

const skipped = isDebug || isASAN || isWindows;

test.skipIf(skipped)(
  "a collection does not make the stores by name that create fields of instances dearer",
  async () => {
    using dir = tempDir("aot-fields-created-by-name-after-a-collection", files);
    const executable = join(String(dir), "main");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
      stderr: [],
      exitCode: 0,
    });
    const env = { ...bunEnv, BUN_JSC_useConcurrentGC: "0", BUN_JSC_numberOfGCMarkers: "1" };
    const [few, many] = [20_000, 220_000];
    const aStore = async (when: string) => {
      const costs: number[] = [];
      for (const rounds of [few, many]) {
        const run = await measureCommand(String(dir), [executable, String(rounds), when], 120_000, env);
        expect(run.stdout).toBe("0\n");
        if (run.instructions === undefined) return undefined;
        costs.push(run.instructions);
      }
      return (costs[1] - costs[0]) / (many - few);
    };
    const before = await aStore("first");
    const behind = await aStore("last");
    if (before === undefined || behind === undefined)
      return void console.error("SKIPPED: instructions cannot be counted here");
    console.error(
      `a round with the last collection in front of the stores that fill the filter: ${before.toFixed(1)} instructions | behind them: ${behind.toFixed(1)}`,
    );
    // A round is an allocation, its share of two collections and the store. The long way costs 60 instructions more.
    expect(behind - before).toBeLessThan(20);
  },
  240_000,
);
