// On ARM64 a call reaches 128 MB. In a larger program a call between functions that lie further apart goes through a jump behind the caller, and the code that all
// functions share is there several times, each copy within reach of its callers. No test program is that large, so the reach is lowered.
// How the code is laid out: the engine's native tests image/layout/*. Here a program runs that is laid out so.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

const count = 1200;
const callee = (index: number) => `f${(index * 7 + 3) % count}`;
const bodies: ((index: number) => string)[] = [
  index => `return depth > 0 ? ${callee(index)}(depth - 1, text + "a") : text;`,
  index =>
    `try { if (depth === 0) throw new RangeError(text); return ${callee(index)}(depth - 1, text) + "b"; } catch (error) { return (error as Error).message + "c"; }`,
  index => `return /^(a+)(b*)/.test(text) ? ${callee(index)}(depth - 1, text.replace(/a$/, "d")) : text;`,
  index =>
    `const list = [depth, text.length, ${index}]; return depth > 0 ? ${callee(index)}(depth - 1, text + list.map(each => each % 7).join("")) : text;`,
  index =>
    `const record = { depth, text, next: { index: ${index} } }; return depth > 0 ? ${callee(index)}(record.depth - 1, record.text + record.next.index) : JSON.stringify(record);`,
  index => `return depth > 0 ? [${callee(index)}, ${callee(index + 1)}][depth & 1](depth - 1, \`\${text}e\`) : text;`,
];
const program = `${Array.from({ length: count }, (_, index) => `function f${index}(depth: number, text: string): string { ${bodies[index % bodies.length](index)} }`).join("\n")}
async function later(depth: number): Promise<string> {
  return depth > 0 ? (await later(depth - 1)) + f${count - 1}(depth, "a") : "";
}
let sum = 0;
for (const first of [${Array.from({ length: count }, (_, index) => `f${index}`).join(", ")}]) for (const character of first(9, "a")) sum = (sum * 31 + character.charCodeAt(0)) | 0;
console.log(sum, (await later(5)).length);
`;

describe.skipIf(!!unsupported)("calls beyond their reach", () => {
  const { folder, build } = sharedBuilds("calls-beyond-their-reach", { "program.ts": program });
  const counted = (text: string, name: string) => Number(new RegExp(`^${name} (\\d+)$`, "m").exec(text)?.[1] ?? 0);
  const built = (...flags: string[]) => build("program.ts", "--aot", "--explain=statistics", ...flags);
  const printedBy = async (cmd: string[]) => {
    const { stdout, exitCode } = await run(cmd, folder, bunEnv);
    return { stdout, exitCode };
  };

  test("a program whose functions are all out of reach of each other prints what it prints in plain Bun", async () => {
    const far = await built("--aot-limit=FunctionCallReach:0");
    expect(counted(far.stderr + far.stdout, "Veneers")).toBeGreaterThan(count / 2);
    expect(await printedBy([far.executable])).toEqual(await printedBy([bunExe(), "program.ts"]));
  });

  test("so does one that holds the shared code several times", async () => {
    const usual = await built();
    const sharedCodeSize = counted(usual.stderr + usual.stdout, "SharedCodeBytesEmitted");
    expect(sharedCodeSize).toBeGreaterThan(0);
    const otherCodeSize = counted(usual.stderr + usual.stdout, "CodeBytesEmitted") - sharedCodeSize;
    expect(otherCodeSize).toBeGreaterThan(0);
    // A copy serves the functions that lie within the reach less its own size, on either side: a quarter of them here, however large the shared code is.
    const far = await built(`--aot-limit=DirectCallReach:${sharedCodeSize + Math.ceil(otherCodeSize / 8)}`);
    expect(counted(far.stderr + far.stdout, "SharedCodeBytesEmitted")).toBeGreaterThan(2 * sharedCodeSize);
    expect(await printedBy([far.executable])).toEqual(await printedBy([bunExe(), "program.ts"]));
  });
});
