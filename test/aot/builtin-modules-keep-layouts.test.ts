import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { mutatedTypesFlags, parseOpenTypes } from "./open-types";
import { test } from "./supported";

const points = `interface Point { x: number; y: number }
const points: Point[] = [];
for (let i = 0; i < 3; i++) points.push({ x: i, y: i + 1 });
console.log(points.map(point => point.x + point.y).join());
`;

async function findPointMutations(source: string) {
  using dir = tempDir("aot-builtin-modules-keep-layouts", { "main.ts": source });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", ...mutatedTypesFlags, "main.ts", "--outfile", "main"],
    String(dir),
  );
  const reasons = parseOpenTypes(stdout + stderr)
    .filter(type => type.name === "Point")
    .map(type => type.reason);
  return { exitCode, mutations: [...new Set(reasons)] };
}

test("importing a typed built-in module mutates no layout of the program", async () => {
  expect(
    await findPointMutations(
      `import { EventEmitter } from "node:events";\nconsole.log(typeof EventEmitter);\n` + points,
    ),
  ).toEqual({ exitCode: 0, mutations: [] });
}, 120_000);

test("Object.freeze of a parsed value mutates no layout of the program", async () => {
  const frozenParsedValue = `function close(value: any) {\n  return Object.freeze(value);\n}\nconsole.log(Object.isFrozen(close(JSON.parse("{}"))));\n`;
  expect(await findPointMutations(points + frozenParsedValue)).toEqual({ exitCode: 0, mutations: [] });
}, 120_000);

// TODO: the report lists no layout that the program changes.
test.todo(
  "deleting a field of a Point lists Point",
  async () => {
    expect(await findPointMutations(points + `delete (points[0] as any).y;\nconsole.log(points[0]!.x);\n`)).toEqual({
      exitCode: 0,
      mutations: expect.arrayContaining(["delete-field"]),
    });
  },
  120_000,
);

test.todo(
  "freezing a Point lists Point (a frozen object keeps its layout, and no report names the place that freezes it)",
);
