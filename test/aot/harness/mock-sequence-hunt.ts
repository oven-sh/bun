// A wide draw from the alphabet of mock-sequence-files.ts, run by one binary under `bun test` and under `bun test --aot`. The tests hold some two hundred sequences; this looks for new ones,
// and asks another build of Bun what it says of those that the tests hold.
//   <bun> run mock-sequence-hunt.ts draw <per group> <seed> > ids.txt    the draw: the same for every binary
//   <bun> run mock-sequence-hunt.ts stored > ids.txt                     the sequences that the tests hold
//   <bun> run mock-sequence-hunt.ts run <ids.txt> <out.txt> <pack> <jobs>  packs of <pack> sequences as one program, a realm a file (pack 1: each alone, one realm)
//   <bun> run mock-sequence-hunt.ts ends <folder for a temporary one>    what the next test file sees, as mock-ends.test.ts asks it
//   <bun> run mock-sequence-hunt.ts files <id> <folder>                  the project of one sequence: cd <folder>; <bun> test [--aot] ./test/<id>.test.js
// out.txt: a line a difference, as mock-sequences.known.txt holds them, and `# plain | <key> | <what plain says>` beside each.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { all, alphabet, differences, filesOf, printed, sequenceOf, type Body, type Sequence } from "./mock-sequence-files.ts";

const fresh = ["original", "actual", "throws-late", "comment", "string", "single", "single-over", "single-actual"];
const groups: [string, string, Body][] = [
  ["js", "late", ""], ["js", "top", ""], ["js", "required", ""], ["cjs", "late", ""], ["cjs", "top", ""], ["cjs", "required", ""],
  ["js", "late", "awaits"], ["js", "top", "awaits"], ["js", "required", "awaits"],
  ["js", "late", "throws"], ["js", "required", "throws"], ["cjs", "late", "throws"], ["cjs", "required", "throws"],
];

function draw(perGroup: number, seed: number): string[] {
  let state = seed >>> 0;
  const next = (below: number) => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 8) % below;
  const ids: string[] = [];
  for (const [kind, place, body] of groups) {
    const seen = new Set<string>();
    while (seen.size < perGroup) {
      const steps = [0, 1, 2].map(() => alphabet[next(alphabet.length)]);
      // With a body that the old lists have, a sequence of old events alone is in them or was drawn for them.
      if (!body && !steps.some(step => fresh.includes(step))) continue;
      seen.add(steps.join(","));
    }
    for (const steps of seen) ids.push(sequenceOf(steps, kind, place, body).id);
  }
  return ids;
}

function sequenceOfId(id: string): Sequence {
  const [steps, kind, place, body = ""] = id.split(".");
  return sequenceOf(steps.replaceAll("+", ","), kind, place, body as Body);
}

const env = { ...process.env, NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1" };

async function runOf(cwd: string, ids: string[], flags: string[]) {
  const child = Bun.spawn([process.execPath, "test", ...flags, ...ids.map(id => `./test/${id}.test.js`)], { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => child.kill(9), 400_000);
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  return printed(stdout, stderr, exitCode, ids);
}

async function pack(ids: string[], way: string, root: string): Promise<string[]> {
  const dir = mkdtempSync(join(root, "pack-"));
  const files: Record<string, string> = Object.assign({ "package.json": `{ "type": "module" }` }, ...ids.map(id => filesOf(sequenceOfId(id), 0)));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const flags = ids.length > 1 ? ["--isolate"] : [];
  const plain = await runOf(dir, ids, flags);
  const compiled = await runOf(dir, ids, ["--aot", ...flags]);
  rmSync(dir, { recursive: true, force: true });
  const lines: string[] = [];
  if (!plain.size) lines.push(`# NOTHING PRINTED UNDER plain: ${ids[0]} and ${ids.length - 1} more`);
  for (const line of differences(plain, compiled, way)) {
    const key = line.split(" | ")[0].replace(/ (loud|SILENT)$/, "").replace(/^\S+ /, "");
    lines.push(line, `# plain | ${key} | ${plain.get(key) ?? "nothing"}`);
  }
  return lines;
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "draw") console.log(draw(Number(rest[0]), Number(rest[1])).join("\n"));
else if (mode === "run") {
  const [list, out, size, jobs] = [rest[0], rest[1], Number(rest[2]), Number(rest[3])];
  const ids = readFileSync(list, "utf8").split("\n").filter(Boolean);
  const packs: string[][] = [];
  for (let at = 0; at < ids.length; at += size) packs.push(ids.slice(at, at + size));
  const root = mkdtempSync(join(dirname(out), "hunt-"));
  const found: string[] = [];
  let taken = 0, done = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (taken < packs.length) {
        const mine = packs[taken++];
        found.push(...(await pack(mine, size > 1 ? "one" : "alone", root)));
        console.error(`${++done} of ${packs.length} packs`);
        writeFileSync(out + ".part", found.join("\n") + "\n");
      }
    }),
  );
  rmSync(root, { recursive: true, force: true });
  writeFileSync(out, found.join("\n") + "\n");
  rmSync(out + ".part", { force: true });
} else if (mode === "stored") console.log(all.map(({ id }) => id).join("\n"));
else if (mode === "ends") {
  const ordered = all.filter(({ body }) => body !== "throws").sort((a, b) => Number(a.steps.includes("reset")) - Number(b.steps.includes("reset")));
  const dir = mkdtempSync(join(rest[0], "ends-"));
  for (const [name, text] of Object.entries(Object.assign({ "package.json": `{ "type": "module" }` }, ...ordered.map(sequence => filesOf(sequence, 0, true))) as Record<string, string>)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const seen = async (flags: string[]) => {
    const child = Bun.spawn([process.execPath, "test", "--no-isolate", ...flags, ...ordered.flatMap(({ id }) => [`./test/${id}.test.js`, `./test/${id}.test.next.test.js`])], { cwd: dir, env: { ...env, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return new Map((stdout + "\n" + stderr).split("\n").flatMap(line => { const found = line.match(/^\| (\S+) 8 \S+ (values|names): (.*)$/); return found ? [[`${found[1]} ${found[2]}`, found[3]] as [string, string]] : []; }));
  };
  const [plain, compiled] = [await seen([]), await seen(["--aot"])];
  console.log(`# ${plain.size} lines under plain of ${ordered.length * 2}`);
  for (const [key, expected] of plain) if (compiled.get(key) !== expected) console.log(`${key}: ${compiled.get(key) ?? "nothing"} | plain ${expected}`);
  rmSync(dir, { recursive: true, force: true });
} else if (mode === "files") {
  for (const [name, text] of Object.entries({ "package.json": `{ "type": "module" }`, ...filesOf(sequenceOfId(rest[0]), 0) })) {
    mkdirSync(dirname(join(rest[1], name)), { recursive: true });
    writeFileSync(join(rest[1], name), text);
  }
} else console.error("draw <per group> <seed> | stored | run <ids.txt> <out.txt> <pack> <jobs> | ends <folder> | files <id> <folder>");
