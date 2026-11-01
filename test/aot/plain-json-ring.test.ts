import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./harness/default-timeout";

// The fast way of JSON.stringify keeps no list of what it is inside of: on a ring it goes on until something stops it, and with an indent
// each level writes more spaces than the last. What finds the ring early came with the ahead-of-time compiler, and plain Bun has it too.
// Without it one call costs most of a second, and every answer is still right: so this is timed, and it runs plain.
const program = `
const ringAt = depth => { const top = { a: 1 }; let at = top; for (let i = 1; i < depth; i++) at = at.m = { a: i }; at.m = top; return top; };
const arrayRing = () => { const top = [1]; top.push([2, top]); return top; };
const shapes = {
  "depth 1, indent 2": [300, () => JSON.stringify(ringAt(1), null, 2)],
  "depth 1, indent 2, many": [30000, () => JSON.stringify(ringAt(1), null, 2)],
  "depth 1, indent 10": [300, () => JSON.stringify(ringAt(1), null, 10)],
  "depth 1, a text for an indent": [300, () => JSON.stringify(ringAt(1), null, "\\t")],
  "depth 1, no indent": [300, () => JSON.stringify(ringAt(1))],
  "depth 10, indent 2": [300, () => JSON.stringify(ringAt(10), null, 2)],
  "depth 10, no indent": [300, () => JSON.stringify(ringAt(10))],
  "depth 100, indent 2": [300, () => JSON.stringify(ringAt(100), null, 2)],
  "depth 1000, no indent": [300, () => JSON.stringify(ringAt(1000))],
  "an array, indent 2": [300, () => JSON.stringify(arrayRing(), null, 2)],
  "an array, no indent": [300, () => JSON.stringify(arrayRing())],
  "a replacer, indent 2": [300, () => JSON.stringify(ringAt(1), (key, value) => value, 2)],
  "a list of keys, indent 2": [300, () => JSON.stringify(ringAt(1), ["a", "m"], 2)],
  "toJSON gives the ring, indent 2": [300, () => JSON.stringify({ toJSON: () => ringAt(1) }, null, 2)],
  "toJSON inside the ring, indent 2": [300, () => { const top = { a: 1, toJSON() { return { inner: top.held }; } }; top.held = { top }; return JSON.stringify(top, null, 2); }],
  "behind long texts, indent 2": [30, () => { const top = { list: Array.from({ length: 3000 }, (_, i) => "text " + i) }; top.self = { inner: top }; return JSON.stringify(top, null, 2); }],
  "behind long texts, no indent": [30, () => { const top = { list: Array.from({ length: 3000 }, (_, i) => "text " + i) }; top.self = { inner: top }; return JSON.stringify(top); }],
};
for (const [name, [rounds, stringify]] of Object.entries(shapes)) {
  const before = process.cpuUsage(); let thrown = 0;
  let round = 0, spent = 0;
  for (; round < rounds && spent < 10; round++) {
    try { stringify(); } catch (error) { if (error instanceof TypeError || error instanceof RangeError) thrown++; }
    const used = process.cpuUsage(before); spent = (used.user + used.system) / 1e6;
  }
  console.log(JSON.stringify({ name, rounds: round, thrown, millisecondsEach: (spent * 1000) / round }));
}
`;

test("plain Bun finds a ring in JSON.stringify early", async () => {
  using dir = tempDir("plain-json-ring", { "rings.js": program });
  await using child = Bun.spawn({
    cmd: [bunExe(), "run", "rings.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 240_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const lines = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as { name: string; rounds: number; thrown: number; millisecondsEach: number });
  expect({ stderr, exitCode, shapes: lines.length }).toEqual({ stderr: "", exitCode: 0, shapes: 17 });
  expect(lines.filter(line => line.thrown !== line.rounds)).toEqual([]);
  // With what finds the ring: 2 ms a call at most. Without it: 1,000.
  expect(lines.filter(line => line.millisecondsEach > 100)).toEqual([]);
}, 300_000);
