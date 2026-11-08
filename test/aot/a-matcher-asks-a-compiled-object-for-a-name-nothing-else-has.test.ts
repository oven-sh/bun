import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

// A string constant of compiled code is a static string that is no atom. The atom that native code makes of one is a block of its own, and it lives only as long as somebody holds it.
// toHaveProperty() held the name of each step of its path by a bare pointer: the atom was freed before the lookup, and the lookup on a compiled object counted a reference on the freed block,
// which by then held the allocator's list of free blocks. The strings that are kept afterwards use those blocks up: the process died in malloc.
const asked = `
import { expect, test } from "bun:test";

class Facts {
  kernel = "6.1";
  cores = 4;
}

test("a compiled object is asked for names that nothing else in the program has", () => {
  const facts = new Facts();
  const kept: string[] = [];
  const fill = () => {
    for (let i = 0; i < 40000; i++) kept.push((i + 1000000).toString(36));
  };
  fill();
  kept.length = 20000;
  Bun.gc(true);
  expect(facts).not.toHaveProperty("nobody_else_says_this_1");
  fill();
  expect(facts).not.toHaveProperty("nobody_else_says_this_2");
  fill();
  expect(facts).not.toHaveProperty("nobody_else_says_this_3.nor_this");
  fill();
  expect(facts).not.toHaveProperty(["nobody_else_says_this_4", "nor_this_either"]);
  fill();
  expect(facts).toHaveProperty("cores", 4);
  expect(kept.length).toBe(180000);
});
`;

test("toHaveProperty() holds the names of its path while it looks them up", async () => {
  using dir = tempDir("a-name-nothing-else-has", { "asked.test.ts": asked });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--debug-aot", "asked.test.ts"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("[aot] module: ");
  expect(stderr).toContain("1 pass");
  expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
});
