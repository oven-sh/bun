// `bun build --compile --aot` gives each executable a name of 32 hexadecimal digits, made of the program and of the build of Bun. It tells the
// builds of one program apart in a crash report. Nothing compares it with anything when the executable starts.
import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, tempDir } from "harness";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withoutCoreDump } from "./harness/commands";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

setDefaultTimeout(120_000);

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(withoutCoreDump(cmd), cwd, { ...bunEnv, ...env });
  return { stdout, stderr, exitCode };
}
const named = (name: string) => (isWindows ? name + ".exe" : name);
async function build(cwd: string, outfile: string, ...flags: string[]) {
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "main.js", "--outfile", named(outfile)],
    cwd,
  );
  expect(built.stderr).not.toMatch(/^error\b/m);
  expect(built.exitCode).toBe(0);
  const ids = [...built.stdout.matchAll(/^ +build id  ([0-9a-f]{32})$/gm)].map(match => match[1]);
  expect(ids).toHaveLength(1);
  return ids[0];
}
const asked = (executable: string, cwd: string) => run([executable], cwd, { BUN_OPTIONS: "--aot-build-id" });
// The 16 bytes behind the head of the note, which is the same in every format.
function readFromFile(path: string) {
  const file = readFileSync(path);
  const head = Buffer.from([4, 0, 0, 0, 16, 0, 0, 0, 1, 0, 0, 0, 0x42, 0x75, 0x6e, 0]);
  const found: string[] = [];
  for (let at = file.indexOf(head); at >= 0; at = file.indexOf(head, at + 1))
    found.push(file.subarray(at + 16, at + 32).toString("hex"));
  return found;
}
function readGnuBuildId(path: string) {
  const file = readFileSync(path);
  const at = file.indexOf(Buffer.from([4, 0, 0, 0, 20, 0, 0, 0, 3, 0, 0, 0, 0x47, 0x4e, 0x55, 0]));
  expect(at).toBeGreaterThan(0);
  return file.subarray(at + 16, at + 36).toString("hex");
}
const main = `console.log("ran");\n`;
const crashes = (name: string) =>
  `import { read } from "bun:ffi";\nfunction ${name}() { return read.u8(8, 0); }\nconsole.log(${name}());\n`;

/** One build of `text` for all the tests that ask for it. */
function builtOnce(text: string, ...flags: string[]) {
  const dir = tempDir("aot-build-id", { "main.js": text });
  afterAll(() => dir[Symbol.dispose]());
  const folder = String(dir);
  let id: Promise<string> | undefined;
  return async () => ({ id: await (id ??= build(folder, "app", ...flags)), folder, app: join(folder, named("app")) });
}
const ran = builtOnce(main, "--aot-report=report.json");
const peeks = builtOnce(crashes("peek"));

describe.concurrent("where it shows", () => {
  test("the build prints it, the executable says it without running the program, and the file holds it", async () => {
    const { id, folder, app } = await ran();
    expect(await asked(app, folder)).toEqual({ stdout: id + "\n", stderr: "", exitCode: 0 });
    expect(readFromFile(app)).toEqual([id]);
    expect(await run([app], folder)).toEqual({ stdout: "ran\n", stderr: "", exitCode: 0 });
  });
  test("the build report has it", async () => {
    const { id, folder } = await ran();
    expect(JSON.parse(readFileSync(join(folder, "report.json"), "utf8")).buildId).toBe(id);
  });
  test.skipIf(isASAN)("a crash report has it in a line of its own", async () => {
    const { id, folder, app } = await peeks();
    const { stderr } = await run([app], folder, {
      BUN_CRASH_REPORT_URL: "",
      BUN_ENABLE_CRASH_REPORTING: "0",
    });
    expect(stderr).toContain("Compiled JavaScript on the stack:\n");
    expect(stderr.split("\n")).toContain("Build ID: " + id);
  });
  test.skipIf(!isLinux)("the GNU build ID begins like that of Bun and ends with the start of it", async () => {
    const { id, app } = await ran();
    expect(readGnuBuildId(app)).toBe(readGnuBuildId(bunExe()).slice(0, 32) + id.slice(0, 8));
  });
  const strip = Bun.which("llvm-strip") ?? Bun.which("strip");
  test.skipIf(!isLinux || !strip)("strip keeps it, and readelf shows it as a note of Bun", async () => {
    const { id, app } = await ran();
    using dir = tempDir("aot-build-id", {});
    const stripped = join(String(dir), "stripped");
    copyFileSync(app, stripped);
    expect((await run([strip!, stripped], String(dir))).exitCode).toBe(0);
    expect(await asked(stripped, String(dir))).toEqual({ stdout: id + "\n", stderr: "", exitCode: 0 });
    expect(readFromFile(stripped)).toEqual([id]);
    const readelf = Bun.which("llvm-readelf") ?? Bun.which("readelf");
    if (readelf) {
      const notes = (await run([readelf, "-n", stripped], String(dir))).stdout;
      expect(notes).toMatch(/\.note\.bun\.build-id[^]*?\bBun\s+0x0*10\b/);
      expect(notes.replace(/\s/g, "")).toContain(id);
    }
  });
});

describe.concurrent.skipIf(isASAN)("the link of a crash report", () => {
  const quiet = { BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" };
  const decoded = (executable: string, cwd: string, link: string) =>
    run([executable], cwd, { BUN_OPTIONS: "--aot-decode-crash-report=" + link });
  const looks = builtOnce(crashes("look"));
  async function crash(built: typeof peeks) {
    const { id, folder, app } = await built();
    const link = (await run([app], folder, quiet)).stderr.match(/^ (\S*\/\d+\.\d+\.\d+\/\S+)$/m)?.[1];
    expect(link).toBeString();
    return { id, folder, app, link: link! };
  }
  test("it has the start of the id once, and only the build that crashed reads it", async () => {
    const [one, two] = await Promise.all([crash(peeks), crash(looks)]);
    expect(one.link.split("aot" + one.id.slice(0, 16))).toHaveLength(2);
    // The field after it can begin with the id's next character, so a few more are compared.
    expect(one.link).not.toContain(one.id.slice(0, 20));

    const own = await decoded(one.app, one.folder, one.link);
    expect(own.stdout).toMatch(/^ +at \S*main\.js:\d+:\d+$/m);
    expect({ stderr: own.stderr, exitCode: own.exitCode }).toEqual({ stderr: "", exitCode: 0 });

    expect(await decoded(two.app, two.folder, one.link)).toEqual({
      stdout: "",
      stderr: `error: --aot-decode-crash-report: that report is from the build whose ID starts with ${one.id.slice(0, 16)}. The ID of this executable starts with ${two.id.slice(0, 16)}. Only the build that crashed can read its report\n`,
      exitCode: 1,
    });
  });
  test("a link that names no build is refused", async () => {
    const { id, folder, app, link } = await crash(peeks);
    const unnamed = link.replace("CmBaot" + id.slice(0, 16), "CGaot");
    expect(unnamed).not.toBe(link);
    expect(await decoded(app, folder, unnamed)).toEqual({
      stdout: "",
      stderr: `error: --aot-decode-crash-report: that report names no build, so it is not from this executable, whose build ID starts with ${id.slice(0, 16)}\n`,
      exitCode: 1,
    });
  });
});

describe.concurrent("what it follows", () => {
  test("the same sources and options give the same id: in another folder, into another folder, with another number of threads", async () => {
    using first = tempDir("aot-build-id-first", { "main.js": main, "out/keep": "" });
    const ids = await Promise.all([
      ran().then(({ id }) => id),
      build(String(first), "app", "--aot-threads=1"),
      build(String(first), join("out", "app"), "--aot-threads=8"),
    ]);
    expect(new Set(ids).size).toBe(1);
  });
  test("a file that is renamed keeps its id", async () => {
    const { id, app } = await ran();
    using dir = tempDir("aot-build-id", {});
    const renamed = join(String(dir), named("renamed"));
    copyFileSync(app, renamed);
    expect(await asked(renamed, String(dir))).toEqual({ stdout: id + "\n", stderr: "", exitCode: 0 });
  });
  test("another program, another embedded file and other arguments for the run time each give another id", async () => {
    const withFile = `import path from "./data.bin" with { type: "file" };\nconsole.log(typeof path);\n`;
    using dir = tempDir("aot-build-id", { "main.js": main });
    using changed = tempDir("aot-build-id", { "main.js": `console.log("run");\n` });
    using one = tempDir("aot-build-id", { "main.js": withFile, "data.bin": "one" });
    using two = tempDir("aot-build-id", { "main.js": withFile, "data.bin": "two" });
    const ids = await Promise.all([
      ran().then(({ id }) => id),
      build(String(changed), "app"),
      build(String(one), "app"),
      build(String(two), "app"),
      build(String(dir), "with-arguments", "--compile-exec-argv=--smol"),
    ]);
    expect(new Set(ids).size).toBe(5);
  });
});

describe.concurrent("who has none", () => {
  const refusal = {
    stdout: "",
    stderr: "error: --aot-build-id: this executable holds no compiled program\n",
    exitCode: 1,
  };
  test("Bun itself", async () => {
    using dir = tempDir("aot-build-id", {});
    expect(await run([bunExe(), "--aot-build-id"], String(dir))).toEqual(refusal);
    expect(readFromFile(bunExe())).toEqual(["0".repeat(32)]);
  });
  test("an executable that is built without --aot", async () => {
    using dir = tempDir("aot-build-id", { "main.js": main });
    const built = await run([bunExe(), "build", "--compile", "main.js", "--outfile", named("plain")], String(dir));
    expect(built.exitCode).toBe(0);
    expect(built.stdout).not.toContain("build id");
    const plain = join(String(dir), named("plain"));
    expect(await asked(plain, String(dir))).toEqual(refusal);
    expect(readFromFile(plain)).toEqual(["0".repeat(32)]);
    if (isLinux) expect(readGnuBuildId(plain)).toBe(readGnuBuildId(bunExe()));
  });
});
