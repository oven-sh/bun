import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// The engine turned what was thrown into a TypeError where the stack walk for a handler passes over the frame of the wrapped function. Compiled code finds its handler without such a walk, and a native
// caller has popped that frame before one begins: both were handed the inner realm's own object, and through it the realm's Error, its Function and its global object.
const program = join(
  import.meta.dir,
  "programs",
  "host-classes",
  "nothing-that-is-thrown-in-a-shadow-realm-leaves-it-as-it-is.mjs",
);
const answers = `throwsError(): caught a TypeError of the outer realm
throwsNumber(): caught a TypeError of the outer realm
throwsLiteral(): caught a TypeError of the outer realm
throwsFunction(): caught a TypeError of the outer realm
throwsInGetter(): caught a TypeError of the outer realm
overflows(): caught a TypeError of the outer realm
throwsNative(): caught a TypeError of the outer realm
boundInside(): caught a TypeError of the outer realm
proxyInside(): caught a TypeError of the outer realm
nativeInside('{'): caught a TypeError of the outer realm
givesThrower()(): caught a TypeError of the outer realm
call: caught a TypeError of the outer realm
apply: caught a TypeError of the outer realm
Reflect.apply: caught a TypeError of the outer realm
Reflect.apply of the bound one: caught a TypeError of the outer realm
bind: caught a TypeError of the outer realm
forEach: caught a TypeError of the outer realm
map: caught a TypeError of the outer realm
sort: caught a TypeError of the outer realm
replace: caught a TypeError of the outer realm
replace by a text: caught a TypeError of the outer realm
JSON.parse: caught a TypeError of the outer realm
JSON.stringify: caught a TypeError of the outer realm
Map.forEach: caught a TypeError of the outer realm
a getter that is the thrower: caught a TypeError of the outer realm
valueOf: caught a TypeError of the outer realm
toString: caught a TypeError of the outer realm
an iterator's next: caught a TypeError of the outer realm
a proxy's trap: caught a TypeError of the outer realm
through any: caught a TypeError of the outer realm
evaluate throws: caught a TypeError of the outer realm
evaluate of bad syntax: caught an outer SyntaxError
evaluate gives an object: caught a TypeError of the outer realm
an object as an argument: caught a TypeError of the outer realm
an async function of the realm: caught a TypeError of the outer realm
a callback that throws, caught inside: answered the primitive true,true,true
a callback that throws a literal, caught inside: answered the primitive true,true,true
a callback that throws, not caught inside: caught a TypeError of the outer realm
new Promise(thrower): rejected a TypeError of the outer realm
then(thrower): rejected a TypeError of the outer realm
an async caller: rejected a TypeError of the outer realm
importValue of nothing: rejected a TypeError of the outer realm
`;

async function run(cmd: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}
const right = { stdout: answers, stderr: "", exitCode: 0, signalCode: null };

test("with the JIT", async () => {
  expect(await run([bunExe(), program])).toEqual(right);
});

test("without the JIT", async () => {
  expect(await run([bunExe(), program], { BUN_JSC_useJIT: "0" })).toEqual(right);
});

test("as an executable", async () => {
  using dir = tempDir("out-of-a-shadow-realm", {});
  const executable = join(String(dir), "program");
  const build = await run([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable]);
  expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run([executable])).toEqual(right);
});
