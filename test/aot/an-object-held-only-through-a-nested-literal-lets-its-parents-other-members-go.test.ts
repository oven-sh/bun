import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A row lists two nested literals: a small header and a large body. Each way of copying keeps the header and drops the row and its body.
// A collection then finds the bodies unreferenced, whatever the copy was made by.
const files = {
  "main.ts": `
    type Body = { kind: string; file: { path: string; text: string } };
    type Row = { kind: string; id: string; header: { role: string; tags: string[] }; body?: Body | string };
    const count = 100;
    let serial = 0;
    const make = (): Row => {
      const n = ++serial;
      return { kind: "row", id: "r" + n, header: { role: "reader", tags: ["a", "b"] }, body: { kind: "text", file: { path: "/p/" + n, text: ("t" + n + " ").repeat(4000) } } };
    };
    const ways: [string, (row: Row) => unknown][] = [
      ["spread, body replaced", row => ({ ...row, body: "none" })],
      ["spread, body undefined", row => ({ ...row, body: undefined })],
      ["spread, then assigned", row => { const copy = { ...row }; copy.body = "none"; return copy; }],
      ["spread, then deleted", row => { const copy = { ...row }; delete copy.body; return copy; }],
      ["rest", row => { const { body, ...rest } = row; return rest; }],
      ["Object.assign", row => Object.assign({}, row, { body: "none" })],
      ["member by member", row => ({ kind: row.kind, id: row.id, header: row.header, body: "none" })],
      ["the header alone", row => row.header],
      ["the header's list alone", row => row.header.tags],
    ];
    const kept: unknown[] = [];
    const answers: Record<string, number> = {};
    for (const [name, copy] of ways) {
      const bodies: WeakRef<object>[] = [];
      for (let i = 0; i < count; i++) {
        const row = make();
        bodies.push(new WeakRef(row.body as Body));
        kept.push(copy(row));
      }
      await new Promise<void>(resolve => setTimeout(resolve, 1));
      Bun.gc(true);
      answers[name] = bodies.filter(body => body.deref() !== undefined).length;
    }
    console.log(JSON.stringify({ kept: kept.length, answers }));
  `,
};

test("a copy that shares one nested literal of a row does not hold the row's other members", async () => {
  using dir = tempDir("aot-nested-literal-outlives-its-row", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const ran = await run([executable], String(dir));
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { kept, answers } = JSON.parse(ran.stdout) as { kept: number; answers: Record<string, number> };
  expect(kept).toBe(900);
  // The last row made may still be named by a register or a stack slot.
  for (const [way, alive] of Object.entries(answers)) expect({ way, few: alive <= 2 }).toEqual({ way, few: true });
}, 240_000);
