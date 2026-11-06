import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` runs what Bun's transpiler prints of a file, and an error quotes that. A compiled run reads the line from the file, where the names still stand.
const files = {
  "quotes.test.ts": `import { test } from "bun:test";
type Box = { value: unknown } | null;
const told: string[] = [];
function tell(label: string, run: () => unknown) {
  try {
    run();
    told.push(label + ": nothing thrown");
  } catch (error) {
    told.push(label + ": " + (error as Error).message);
  }
}
function lookup(x: Box): Box { return x; }
function initializer(x: Box) { const r: Box = lookup(x); return r!.value; }
function initializerOnLines(x: Box) {
  const r: Box = lookup(x);
  return r!.value;
}
function inBrackets(x: Box, y: Box) { const r = x || y; return r!.value; }
function base() { const holder: Box = null; return holder!.value; }
function undefinedBase() { const holder = undefined; return (holder as any).value; }
function key(o: any) { const k = "name"; return o[k]; }
function keyBehindStatement(o: any) { tell; const k = "name"; return o[k]; }
function parameterKey(o: any, k: string) { return o[k]; }
function argument(o: any) { const a = 5; return o.run(a, 1 + 2, true, undefined, 0x10); }
function stored(o: any) { const v = 7; o.x = v; }
function deleted(o: any) {
  const k = "d";
  delete o[k];
}
function tested(o: any) { const k = "e"; return k in o; }
function chainCalled(o: any) { return (o?.value)(1); }
function memberOfChainCalled(o: any) { return (o?.box).run(1, 2); }
function memberOfChainConstructed(o: any) { return new (o?.box).Made(); }
function memberOfChainInitializerCalled(o: any) { const r = o?.box; return r.run(3); }
function memberOfChainInitializerRead(o: any) { const r = o?.none; return r.value; }
test("quotes", () => {
  tell("initializer", () => initializer(null));
  tell("initializerOnLines", () => initializerOnLines(null));
  tell("inBrackets", () => inBrackets(null, null));
  tell("base", () => base());
  tell("undefinedBase", () => undefinedBase());
  tell("key", () => key(null));
  tell("keyBehindStatement", () => keyBehindStatement(null));
  tell("parameterKey", () => parameterKey(undefined, "name"));
  tell("argument", () => argument({}));
  tell("stored", () => stored(null));
  tell("deleted", () => deleted(null));
  tell("tested", () => tested(null));
  const chained = { value: 1, box: {}, none: null };
  tell("chainCalled", () => chainCalled(chained));
  tell("memberOfChainCalled", () => memberOfChainCalled(chained));
  tell("memberOfChainConstructed", () => memberOfChainConstructed(chained));
  tell("memberOfChainInitializerCalled", () => memberOfChainInitializerCalled(chained));
  tell("memberOfChainInitializerRead", () => memberOfChainInitializerRead(chained));
  console.log(told.join("\\n"));
});
`,
};

test("a compiled test quotes what bun test quotes where the transpiler prints something else than the file has", async () => {
  using dir = tempDir("aot-quotes-of-bun-test", files);
  const directory = String(dir);
  const plain = await run([bunExe(), "test", "./quotes.test.ts"], directory, bunEnv);
  const compiled = await run([bunExe(), "test", "--aot", "./quotes.test.ts"], directory, bunEnv);
  expect(plain.stdout).toContain("initializer: null is not an object (evaluating 'lookup(x).value')");
  expect(plain.stdout).toContain("base: null is not an object (evaluating 'null.value')");
  expect(plain.stdout).toContain("parameterKey: undefined is not an object (evaluating 'o[k]')");
  // The transpiler prints round brackets around an optional chain that something outside the chain reads from or calls, also in place of a name.
  expect(plain.stdout).toContain(
    "memberOfChainCalled: (o?.box).run is not a function. (In '(o?.box).run(1, 2)', '(o?.box).run' is undefined)",
  );
  expect(plain.stdout).toContain("memberOfChainInitializerRead: null is not an object (evaluating '(o?.none).value')");
  const lines = (output: string) => output.split("\n").filter(line => line.includes(": "));
  expect(lines(compiled.stdout)).toEqual(lines(plain.stdout));
  expect(compiled.exitCode).toBe(0);
}, 60_000);
