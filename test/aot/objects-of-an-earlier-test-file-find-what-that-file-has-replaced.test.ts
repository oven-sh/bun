import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `bun test --isolate` gives each test file a fresh realm of one VM, and `Bun.s3` is one object for the VM: what a file hangs on it is there for the next file.
// An object finds the members of the realm that made it. The first file leaves members of its built-ins replaced, and a name added below the one that views inherit; the second asks the objects of the first.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "kit.ts": `export const make = () => ({ list: [3, 1, 2], map: new Map([[1, "one"]]), set: new Set([1]), view: new Uint8Array(5) });
export type All = ReturnType<typeof make>;
function includes(list: number[]) { return list.includes(1); }
function indexOf(list: number[]) { return list.indexOf(1); }
function join(list: number[]) { return list.join("+"); }
function get(map: Map<number, string>) { return map.get(1); }
function has(map: Map<number, string>) { return map.has(1); }
function mapSize(map: Map<number, string>) { return map.size; }
function setHas(set: Set<number>) { return set.has(1); }
function setSize(set: Set<number>) { return set.size; }
function length(view: Uint8Array) { return view.length; }
export const declared = (all: All) => [includes(all.list), indexOf(all.list), join(all.list), get(all.map), has(all.map), mapSize(all.map), setHas(all.set), setSize(all.set), length(all.view)].map(String);
export const untyped = (all: any) => [all.list.includes(1), all.list.indexOf(1), all.list.join("+"), all.map.get(1), all.map.has(1), all.map.size, all.set.has(1), all.set.size, all.view.length].map(String);
`,
  "a.test.ts": `import { test } from "bun:test";
import { declared, make, untyped } from "./kit.ts";
test("the first file leaves its built-ins replaced", () => {
  const kept = make();
  for (let turn = 0; turn < 3; turn++) { declared(kept); untyped(kept); }
  (Bun.s3 as any).kept = kept;
  Array.prototype.includes = function () { return "their includes" as any; };
  Array.prototype.indexOf = function () { return "their indexOf" as any; };
  Array.prototype.join = function () { return "their join"; };
  Map.prototype.get = function () { return "their get"; };
  Map.prototype.has = function () { return "their has" as any; };
  Object.defineProperty(Map.prototype, "size", { get() { return "their map size"; }, configurable: true });
  Set.prototype.has = function () { return "their set has" as any; };
  Object.defineProperty(Set.prototype, "size", { get() { return "their set size"; }, configurable: true });
  Object.defineProperty(Uint8Array.prototype, "length", { get() { return "their length"; }, configurable: true });
  console.log("SEEN first, declared: " + declared(kept).reduce((a, b) => a + " | " + b));
});
`,
  "b.test.ts": `import { test } from "bun:test";
import { declared, make, untyped } from "./kit.ts";
test("the second file asks the objects of the first", () => {
  const theirs = (Bun.s3 as any).kept, ours = make();
  console.log("SEEN second, ours, declared: " + declared(ours).join(" | "));
  console.log("SEEN second, ours, untyped: " + untyped(ours).join(" | "));
  console.log("SEEN second, theirs, declared: " + declared(theirs).join(" | "));
  console.log("SEEN second, theirs, untyped: " + untyped(theirs).join(" | "));
});
`,
};

async function seenWith(...flags: string[]) {
  using dir = tempDir("aot-objects-of-an-earlier-test-file", files);
  const { stdout, exitCode } = await run(
    [bunExe(), "test", "--isolate", ...flags, "./a.test.ts", "./b.test.ts"],
    String(dir),
    bunEnv,
  );
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("objects of an earlier test file find what that file has replaced, whoever asks", async () => {
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  const theirs =
    "their includes | their indexOf | their join | their get | their has | their map size | their set has | their set size | their length";
  const asMade = "true | 1 | 3+1+2 | one | true | 1 | true | 1 | 5";
  expect(plain).toEqual({
    seen: [
      "SEEN first, declared: " + theirs,
      "SEEN second, ours, declared: " + asMade,
      "SEEN second, ours, untyped: " + asMade,
      "SEEN second, theirs, declared: " + theirs,
      "SEEN second, theirs, untyped: " + theirs,
    ],
    exitCode: 0,
  });
  expect(compiled).toEqual(plain);
});
