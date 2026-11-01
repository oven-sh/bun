import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const programs = {
  "the comparison narrows a local that a getter's closure shares": `const T = [];
function f(x, n) {
  let fuel = 3;
  let b = x, c = 1n, e = x, a = x;
  const gt = { get v() { a = b; return 1; } };
  for (let i = 0; i < n; i++) c = e;
  T.push(e === a);
  while (c === b && fuel-- > 0) { gt.v; T.push(b === c); }
  b++;
  return e + 1;
}
console.log(f(1, 2), f("a", 2), T.join());
`,
  "the narrowed local is compared with another": `const T = [];
function show(g) { try { return String(g()); } catch (e) { return e.name; } }
function f(x, n) {
  let fuel = 3;
  let b = x, c = 1n, e = x, a = x;
  const gt = { get v() { a = b; return 1; } };
  for (let i = 0; i < n; i++) c = e;
  
  T.push(e === a);
  while (c === b && fuel-- > 0) { gt.v; T.push(c === a); }
  b++;
  
  return e + 1;
}
console.log(show(() => f(1, 2)), show(() => f("a", 2)), T.map(String).join());
`,
  "the first argument is beyond 32 bits": `const T = [];
function show(g) { try { return String(g()); } catch (e) { return e.name; } }
function f(x, n) {
  let fuel = 3;
  let b = x, c = 1n, e = x, a = x;
  const gt = { get v() { a = b; return 1; } };
  for (let i = 0; i < n; i++) c = e;
  
  T.push(e === a);
  while (c === b && fuel-- > 0) { gt.v; T.push(b === c); }
  b++;
  
  return e + 1;
}
console.log(show(() => f(2 ** 40, 2)), show(() => f("a", 2)), T.map(String).join());
`,
  "an argument comes out of a Map": `function f(x) {
  let fuel = 6;
  let b = x, c = 1n, a = x;
  const box = { get v() { a = b; return 1; } };
  for (let i = 0; i < 2; i++) c = x;
  console.log(x === a);
  while (c === b && fuel-- > 0) { box.v; console.log(b === c); }
  b++;
  return x + 1;
}
const m = new Map([["k", "a"]]);
for (const v of [1, m.get("k")]) console.log(f(v));
`,
};

for (const [name, source] of Object.entries(programs)) {
  test(`a loop's test that stays the same in every turn and narrows: ${name}`, async () => {
    using dir = tempDir("aot-hoisted-test", { "program.js": source });
    const directory = String(dir);
    const executable = join(directory, `program${isWindows ? ".exe" : ""}`);
    const plain = await run([bunExe(), "program.js"], directory, bunEnv);
    expect(plain.exitCode).toBe(0);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", executable],
      directory,
      bunEnv,
    );
    expect(built.exitCode).toBe(0);
    expect((await run([executable], directory, bunEnv)).stdout).toBe(plain.stdout);
  });
}
