import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// An import below a hoisted mock loads behind the mock, also where nothing spells its names. The other forms are cases of ./fixed-runs/closed (mock-below-*). This one needs
// a tsconfig.json in the folder where the run starts: only decorator metadata names the class, as in a NestJS or Angular service. Every module says when it runs.
const files = {
  "package.json": `{}`,
  "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": false } }`,
  "db.ts": `console.log("runs db"); export const url = "real";`,
  "repo.ts": `console.log("runs repo"); import { url } from "./db"; const atLoad = url; export class Repo { where() { return atLoad; } }`,
  "a.test.ts": `import { test, jest } from "bun:test";
import { Repo } from "./repo";
jest.mock("./db", () => { console.log("factory"); return { url: "mocked" }; });
function Injectable() { return (target: any) => target; }
(Reflect as any).metadata ??= (k: string, v: any) => (t: any, p?: any) => { ((p ? t.constructor : t).meta ??= {})[(p ?? "") + k] = v; };
@Injectable()
class Svc { constructor(private r: Repo) {} where() { return this.r.where(); } }
test("t", () => { const [C] = (Svc as any).meta["design:paramtypes"]; console.log("OUT", C.name, new Svc(new C()).where()); });`,
};

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

test("a constructor's parameter types, and a mock below the class's file", async () => {
  using dir = tempDir("mock-unspelled-names", files);
  const plain = await runTests(String(dir), {});
  expect(plain.exitCode).toBe(0);
  expect(plain.printed.length).toBeGreaterThan(0);
  expect(await runTests(String(dir), { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot")).toEqual(plain);
});
