import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` runs what Bun's transpiler prints of a file, and an error quotes that: where a constant is read once, its value stands in the place of its name.
// A compiled run reads the line from the file, where the names still stand, and quotes them: docs/compiler/compatibility.mdx, "Error messages": "The rest stays as you wrote it".
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
function tagged() { const b: any = null; return b\`t\`; }
function taggedParameter(b: any) { return b\`t\`; }
function taggedMember(o: any) { return o.tag\`t\${1}u\${\`v\${o}\`}w\`; }
function called() { const b: any = undefined; return b(); }
function calledWith() { const b: any = undefined; return b(1, 2); }
function constructed() { const b: any = undefined; return new b(); }
function constructedWith() { const b: any = undefined; return new b(1, 2); }
function constructedCall() { const b: any = lookup(null); return new b(); }
function constructedCallBare() { const b: any = lookup(null); return new b; }
function constructedCallWith() { const b: any = Object.create(null, {}); return new b(1); }
function constructedMemberOfCall() { const b: any = Object.create(null); return new b.member(); }
function constructedNew() { const b: any = new Map(); return new b(); }
function constructedNewBare() { const b: any = new Map(); return new b; }
function constructedNewWith() { const b: any = new Map([]); return new b(2); }
function constructedMemberOfNew() { const b: any = new Map(); return new b.member(); }
function constructedMemberOfArrow() { const b: any = () => 1; return new b.member(); }
function calledOptionalCall(o: any) { const b = o.make?.(); return b(); }
function readOfOptionalMember(o: any) { const b = o?.inner; return b.deep.deeper; }
function chosen(c: boolean) { const b = c ? { x: 1 } : null; return (true && b)!.x; }
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
  tell("tagged", () => tagged());
  tell("taggedParameter", () => taggedParameter(undefined));
  tell("taggedMember", () => taggedMember({}));
  tell("called", () => called());
  tell("calledWith", () => calledWith());
  tell("constructed", () => constructed());
  tell("constructedWith", () => constructedWith());
  tell("constructedCall", () => constructedCall());
  tell("constructedCallBare", () => constructedCallBare());
  tell("constructedCallWith", () => constructedCallWith());
  tell("constructedMemberOfCall", () => constructedMemberOfCall());
  tell("constructedNew", () => constructedNew());
  tell("constructedNewBare", () => constructedNewBare());
  tell("constructedNewWith", () => constructedNewWith());
  tell("constructedMemberOfNew", () => constructedMemberOfNew());
  tell("constructedMemberOfArrow", () => constructedMemberOfArrow());
  tell("calledOptionalCall", () => calledOptionalCall({}));
  tell("readOfOptionalMember", () => readOfOptionalMember({ inner: {} }));
  tell("chosen", () => chosen(false));
  console.log(told.join("\\n"));
});
`,
};

test("a compiled test quotes the file where the transpiler of bun test has put a value in the place of a name", async () => {
  using dir = tempDir("aot-quotes-of-bun-test", files);
  const directory = String(dir);
  const plain = await run([bunExe(), "test", "./quotes.test.ts"], directory, bunEnv);
  const compiled = await run([bunExe(), "test", "--aot", "./quotes.test.ts"], directory, bunEnv);
  expect(plain.stdout).toContain("initializer: null is not an object (evaluating 'lookup(x).value')");
  expect(plain.stdout).toContain("base: null is not an object (evaluating 'null.value')");
  expect(plain.stdout).toContain("parameterKey: undefined is not an object (evaluating 'o[k]')");
  expect(plain.stdout).toContain("tagged: null is not a function (near '...null`t`...')");
  expect(plain.stdout).toContain(
    "calledWith: (void 0) is not a function. (In '(void 0)(1, 2)', '(void 0)' is undefined)",
  );
  expect(plain.stdout).toContain("constructed: undefined is not a constructor (evaluating 'new (void 0)')");
  expect(plain.stdout).toContain("constructedCall: null is not a constructor (evaluating 'new (lookup(null))')");
  expect(plain.stdout).toContain("constructedNew: Map is not a constructor (evaluating 'new new Map()')");
  const lines = (output: string) => output.split("\n").filter(line => line.includes(": "));
  expect(lines(compiled.stdout)).toEqual([
    "initializer: null is not an object (evaluating 'r.value')",
    "initializerOnLines: null is not an object (evaluating 'r.value')",
    "inBrackets: null is not an object (evaluating 'r.value')",
    "base: null is not an object (evaluating 'holder.value')",
    "undefinedBase: undefined is not an object (evaluating 'holder.value')",
    "key: null is not an object (evaluating 'o[k]')",
    "keyBehindStatement: null is not an object (evaluating 'o[k]')",
    "parameterKey: undefined is not an object (evaluating 'o[k]')",
    "argument: o.run is not a function. (In 'o.run(a, 1 + 2, true, undefined, 16)', 'o.run' is undefined)",
    "stored: null is not an object (evaluating 'o.x = v')",
    "deleted: null is not an object (evaluating 'delete o[k]')",
    "tested: o is not an Object. (evaluating 'k in o')",
    "tagged: null is not a function (near '...b`t`...')",
    "taggedParameter: undefined is not a function (near '...b`t`...')",
    "taggedMember: undefined is not a function (near '...o.tag`t${1}u${`v${o}`}w`...')",
    "called: b is not a function. (In 'b()', 'b' is undefined)",
    "calledWith: b is not a function. (In 'b(1, 2)', 'b' is undefined)",
    "constructed: undefined is not a constructor (evaluating 'new b')",
    "constructedWith: undefined is not a constructor (evaluating 'new b(1, 2)')",
    "constructedCall: null is not a constructor (evaluating 'new b')",
    "constructedCallBare: null is not a constructor (evaluating 'new b')",
    "constructedCallWith: Object is not a constructor (evaluating 'new b(1)')",
    "constructedMemberOfCall: undefined is not a constructor (evaluating 'new b.member')",
    "constructedNew: Map is not a constructor (evaluating 'new b')",
    "constructedNewBare: Map is not a constructor (evaluating 'new b')",
    "constructedNewWith: Map is not a constructor (evaluating 'new b(2)')",
    "constructedMemberOfNew: undefined is not a constructor (evaluating 'new b.member')",
    "constructedMemberOfArrow: undefined is not a constructor (evaluating 'new b.member')",
    "calledOptionalCall: b is not a function. (In 'b()', 'b' is undefined)",
    "readOfOptionalMember: undefined is not an object (evaluating 'b.deep.deeper')",
    "chosen: null is not an object (evaluating 'b.x')",
  ]);
  expect(compiled.exitCode).toBe(0);
}, 60_000);
