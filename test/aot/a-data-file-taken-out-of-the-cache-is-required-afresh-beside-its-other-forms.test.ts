import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": JSON.stringify({ name: "probe" }),
  "d.json": JSON.stringify({ a: 1 }),
  "orders.test.mjs": `
import { test } from "bun:test";
import t from "./d.json" with { type: "json" };
const made = JSON.parse('"./d.json"');
const kind = it => (it.default === undefined ? "the value" : typeof it.default === "string" ? "the text" : "the namespace");
test("orders", async () => {
  const said = [typeof t];
  const take = () => delete require.cache[require.resolve("./d.json")];
  const ask = load => { try { said.push(kind(load())); } catch (error) { said.push(error.name); } };
  take();
  ask(() => require(made));
  take();
  ask(() => require("./d.json"));
  await import("./d.json", { with: { type: "text" } });
  take();
  ask(() => require(made));
  console.log("SAID " + said.join(", "));
});
`,
};

test("require() behind a delete from require.cache answers as under bun test, whatever forms of the file are loaded", async () => {
  using dir = tempDir("aot-data-file-out-of-the-cache", files);
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
}, 120_000);
