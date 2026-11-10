import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./harness/commands";
import { describe, test } from "./supported";

const program = `"use strict";
const A = [0.5, 1.5, 2.5].map(v => v * 2), B = [1, 2, 3].map(v => v / 2);
const TABLE = { more: 0.25, less: 0.125 };
const OTHER = [7, 8, 9];
function held(a, b, o) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i]; return s + (o ? o.more : 0); }
function counted(a, b, l) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i]; return s + l.length; }
function withATable(turns) { let s = 0; for (let k = 0; k < turns; k++) s += held(A, B, TABLE); return s; }
function withAList(turns) { let s = 0; for (let k = 0; k < turns; k++) s += counted(A, B, OTHER); return s; }
const out = [];
for (const turns of [0, 1, 5]) out.push(withATable(turns), withAList(turns));
console.log(out.join(" | "));
`;

describe("callees whose loops are written out, copied into loops", () => {
  test("of what a turn hands to the copy only the lists that it reads by key are read in front of the loop", async () => {
    using dir = tempDir("aot-lists-handed-to-copies", { "main.cjs": program });
    const root = String(dir);
    const build = await spawned([bunExe(), "compile", "./main.cjs", "--explain=statistics"], root, bunEnv);
    const count = (name: string) => Number(new RegExp(`^${name} (\\d+)$`, "m").exec(build.stderr)?.[1]);
    const ran = await spawned([join(root, isWindows ? "main.exe" : "main")], root, bunEnv);
    expect({
      exitCode: build.exitCode,
      constantsReadInFront: count("ModuleConstantReadsHoisted"),
      listsOfCopiesAskedInFront: count("InlineeArrayGuardsHoisted") > 0,
      stdout: ran.stdout,
    }).toEqual({
      exitCode: 0,
      constantsReadInFront: 4,
      listsOfCopiesAskedInFront: true,
      stdout: "0 | 0 | 11.25 | 14 | 56.25 | 70\n",
    });
  });
});
