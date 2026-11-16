import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const testFile = (type: string, first: string, underMock = "", last = "said.push(show(require(made)));") => `
import { test, vi } from "bun:test";
const made = JSON.parse(String.fromCharCode(34) + "./d.json" + String.fromCharCode(34));
const seen = [];
const show = it => {
  let at = seen.indexOf(it);
  if (at < 0) at = seen.push(it) - 1;
  return (it.default === undefined ? "the value" : typeof it.default === "string" ? "the text" : "the namespace") + " " + at;
};
test("order", async () => {
  const said = [show(await import("./d.json", { with: { type: "${type}" } }))];
  ${first}
  vi.doMock(require.resolve(made), () => ({ default: { a: "mock" } }));
  ${underMock}
  vi.doUnmock(require.resolve(made));
  ${last}
  console.log("SAID " + said.join(", "));
});
export const never = () => require("./d.json");
`;

const projects = {
  "loaded as text": testFile("text", ""),
  "loaded as json": testFile("json", ""),
  "loaded as text and required in front of the mock: what require() has answered stays": testFile(
    "text",
    "said.push(show(require(made)));",
  ),
  "the mock is replaced by a second: while that stands require() answers it": testFile(
    "text",
    "",
    'vi.doMock(require.resolve(made), () => ({ default: { a: "second" } })); said.push(require(made).default.a);',
    "",
  ),
};
// What is left: what require() answered UNDER the mock leaves with the mock under bun test; compiled it stays.
const notYet = {
  "required under the mock, which then ends": testFile("text", "", "said.push(require(made).default.a);"),
};

for (const [name, text, check] of [
  ...Object.entries(projects).map(([name, text]) => [name, text, test] as const),
  ...Object.entries(notYet).map(([name, text]) => [name, text, test.failing] as const),
]) {
  check(
    `behind a mock of a data file that has ended require() answers as under bun test: ${name}`,
    async () => {
      using dir = tempDir("aot-data-file-behind-an-ended-mock", {
        "package.json": JSON.stringify({ name: "probe" }),
        "d.json": JSON.stringify({ a: 1 }),
        "order.test.mjs": text,
      });
      const seen = async (...flags: string[]) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", ...flags],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        return { said: stdout.split("\n").filter(line => line.startsWith("SAID ")), exitCode };
      };
      const [plain, compiled] = await Promise.all([seen(), seen("--aot")]);
      expect(plain.said).toHaveLength(1);
      expect(compiled).toEqual(plain);
    },
    120_000,
  );
}
