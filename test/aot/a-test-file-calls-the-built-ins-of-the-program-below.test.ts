import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The lowest program of a test run holds all of Bun's own code, compiled. An `await` alone used to bring 34 files of it into the program of a test file again,
// once for every part of a run: three quarters of the time that such a part took to build.

// What these call is in objects of the realm.
const inTheRealm: Record<string, string> = {
  "await": `await null; console.log("await");`,
  "promise": `console.log(await new Promise(done => done("promise")));`,
  "timer": `console.log(await new Promise(done => setTimeout(() => done("timer"), 1)));`,
  "all": `console.log("all", (await Promise.all([1, Promise.resolve(2)])).join());`,
  "generator": `function* count() { yield 1; yield 2; } console.log("generator", [...count()].join());`,
  "for-await": `const seen = []; for await (const value of (async function* () { yield "a"; yield "b"; })()) seen.push(value); console.log("for-await", seen.join());`,
  "then": `console.log("then", await Promise.resolve(1).then(value => value + 1).finally(() => {}));`,
};

// The compiler writes calls of functions of its own for these. No object holds such a function, so it comes along, with what it calls by its own name.
const ofTheCompiler: Record<string, string> = {
  "sort": `console.log("sort", [3, 1, 2].sort((a, b) => a - b).join(), [3, 1, 2].sort((a, b) => b - a).join(), ["b", "a"].sort().join());`,
  "sort-by": `console.log("sort-by", [{ n: 2 }, { n: 1 }].sort((a, b) => (a.n < b.n ? -1 : 1)).map(it => it.n).join(), [2, 1].toSorted().join());`,
  "map": `console.log("map", [3, 1, 2].map(x => x * 2).filter(x => x > 2).reduce((sum, x) => sum + x, 0));`,
  "from": `console.log("from", Array.from(new Set([1, 1, 2]), x => x + 1).join(), Array.from({ length: 2 }, (_, i) => i).join());`,
  "fill": `console.log("fill", new Array(3).fill(0).map((_, i) => i).join(), Array(2).fill("x").join());`,
  "search": `console.log("search", [3, 1, 2].includes(2), [3, 1, 2].indexOf(1));`,
  "flat": `console.log("flat", [1, [2, [3]]].flat(2).join(), [[1], [2]].flatMap(x => x).join());`,
  "collections": `let sum = 0; for (const x of new Map([[1, 2]]).values()) sum += x; for (const x of new Set([3])) sum += x; console.log("collections", sum);`,
  "typed-array": `console.log("typed-array", new Uint8Array([1, 2, 3]).every(x => x > 0), new Uint8Array([1, 2, 3]).find(x => x > 1));`,
  "using": `const log = []; { using x = { [Symbol.dispose]() { log.push("gone"); } }; } console.log("using", log.join());`,
  "await-using": `const log = []; { await using x = { async [Symbol.asyncDispose]() { log.push("gone"); } }; } console.log("await-using", log.join());`,
  "iterator": `console.log("iterator", [1, 2, 3].values().map(x => x * 2).toArray().join(), Iterator.from([1, 2]).flatMap(x => [x, x]).toArray().join());`,
  "objects": `console.log("objects", Object.fromEntries([["k", "v"]]).k, Object.entries({ a: 1 }).join(), Object.groupBy([1, 2, 3], x => (x % 2 ? "odd" : "even")).odd.join());`,
  "unknown": `let thrown; try { globalThis.nobodyKnows(); } catch (error) { thrown = error.name; } console.log("unknown", thrown);`,
};

async function runEachFileAsAPart(forms: Record<string, string>) {
  const files: Record<string, string> = { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": "{}" };
  for (const [name, body] of Object.entries(forms))
    files[`${name}.test.js`] =
      `import { test } from "bun:test";\ntest(${JSON.stringify(name)}, async () => { ${body} });\n`;
  using dir = tempDir("built-ins-of-the-program-below", files);
  const seen = async (env: Record<string, string | undefined>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    // The parts of a run end in any order.
    return { printed: stdout.split("\n").sort(), exitCode, stderr };
  };
  const plain = await seen(bunEnv);
  expect(plain.exitCode).toBe(0);
  const words = { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1", BUN_JSC_logAOTPhaseTimes: "1" };
  const compiled = await seen({ ...bunEnv, ...words }, "--aot");
  expect({ printed: compiled.printed, exitCode: compiled.exitCode }).toEqual({ printed: plain.printed, exitCode: 0 });
  const counts = compiled.stderr.matchAll(/^AOT part build \| files of Bun's own code compiled \| (\d+)$/gm);
  return [...counts].map(match => Number(match[1]));
}

test("a test file brings along none of Bun's own code that the realm holds", async () => {
  expect(await runEachFileAsAPart(inTheRealm)).toEqual(Object.keys(inTheRealm).map(() => 0));
});

test("a test file brings along the functions that the compiler alone calls", async () => {
  const counts = await runEachFileAsAPart(ofTheCompiler);
  expect(counts.length).toBe(Object.keys(ofTheCompiler).length);
});
