// The build target determines `process.platform` and `process.arch`.
//
// Written out (`process.platform`), a read is replaced by a string literal in every `bun build --compile`, with or without --aot,
// because the target defines both paths. An assignment isn't replaced, so such a read never sees it. With --aot the same holds for
// `process["arch"]`: `x["name"]` is `x.name`. Without --aot the brackets stay a read.
//
// Read any other way (`const { platform } = process`, `globalThis.process.platform`, a variable that holds `process`), it is an
// ordinary property that plain Bun lets a program assign, redefine and delete, which tests do to simulate another platform. If the
// program can't change the property, --aot folds the read to the string, so a comparison with a platform name is decided at build
// time and the branch for the other platform is removed. If the program does change it, the output must match plain Bun's.
//
// A change that the compiler can't follow (through a value that native code returned, or made by code in a string) meets reads that are
// folded. The properties of such a program are read-only, like other built-in objects: strict code gets a TypeError and sloppy code changes nothing.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { buildFlags, compileCommand, runtimeEnvironment } from "./harness/flags";
import { printIR, test as testOfIR, writesProgramInto } from "./harness/printed-ir";
import { built, slot, spawned, told, wanted, withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

const groups: [name: string, body: () => void][] = [];
const group = (name: string, body: () => void) => void groups.push([name, body]);
let halfOfChanges = 0;

type Program = {
  /** `main.*` is the entry point; `worker.*` is a second entry point. */
  files: Record<string, string>;
  /** The program evaluates strings as code, which the interpreter runs. */
  evaluatesStrings?: true;
  /** What the executable is compared with: `bun run` by default, or an executable built without --aot. */
  reference?: "compiled";
};

const tsconfig = JSON.stringify({
  compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: ["bun"] },
});

const here = process.platform;
const elsewhere = here === "linux" ? "darwin" : "linux";
const branchForThisPlatform = "the branch for this platform";
const branchForAnotherPlatform = "the branch for another platform";

const changes: Record<string, { text: string; evaluatesStrings?: true; isUnseen?: true }> = {
  "nothing": { text: `` },
  "an assignment": { text: `process.platform = "made up"; process.arch = "made up";` },
  "an assignment with a computed name": { text: `process[decoded("platform")] = "made up"; process[decoded("arch")] = "made up";` },
  "an assignment through an opaque reference": { text: `opaque(process).platform = "made up"; opaque(process).arch = "made up";`, isUnseen: true },
  "an assignment of another platform's name": { text: `process.platform = "${elsewhere}";` },
  "Object.defineProperty": { text: `Object.defineProperty(process, "platform", { value: "made up" }); Object.defineProperty(process, "arch", { value: "made up" });` },
  "Object.defineProperty with a computed name": { text: `Object.defineProperty(process, decoded("platform"), { value: "made up" });` },
  "Object.defineProperties": { text: `Object.defineProperties(process, { platform: { value: "made up" }, arch: { value: "made up" } });` },
  "Object.assign": { text: `Object.assign(process, { platform: "made up", arch: "made up" });` },
  "Reflect.set": { text: `Reflect.set(process, "platform", "made up"); Reflect.set(process, "arch", "made up");` },
  "a getter": { text: `let asked = 0; Object.defineProperty(process, "platform", { get() { return ++asked % 2 ? "made up" : "${elsewhere}"; }, configurable: true });` },
  "delete": { text: `Reflect.deleteProperty(process, "platform"); delete globalThis.process.arch;` },
  "new Function": { text: `new Function(decoded("process.platform = 'made up'; process.arch = 'made up';"))();`, evaluatesStrings: true, isUnseen: true },
  "a script": { text: `import vm from "node:vm";\nvm.runInThisContext(decoded("process.platform = 'made up'; process.arch = 'made up';"));`, evaluatesStrings: true, isUnseen: true },
};

const programThatChanges = ({ text, evaluatesStrings }: (typeof changes)[string]): Program => ({
  evaluatesStrings,
  files: {
    "main.mjs": `const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
function platformName() { return globalThis.process.platform; }
function archName() { return globalThis.process.arch; }
function isHere() { const host = process; return host.platform === "${here}"; }
function branch() {
  const { platform } = process;
  if (platform === "${elsewhere}") return "${branchForAnotherPlatform}";
  return "${branchForThisPlatform}";
}
function chosen() {
  const { platform } = process;
  switch (platform) {
    case "${here}": return "the case for this platform";
    case "${elsewhere}": return "the case for another platform";
    case "made up": return "the case for the made-up platform";
    default: return "no case";
  }
}
function byPattern() { const { platform, arch } = process; return platform + "/" + arch; }
function inAChain() { return process?.platform + "/" + process?.arch; }
function byReflection() { return Reflect.get(process, "platform") + "/" + Reflect.get(process, "arch"); }
function byComputedName() { return process[decoded("platform")] + "/" + process[decoded("arch")]; }
globalThis.kept = [platformName, archName, isHere, branch, chosen];
function show(when) {
  console.log(when + ": " + [platformName(), archName(), isHere(), branch(), chosen(), byPattern(), inAChain(), byReflection(), byComputedName(), typeof globalThis.process.platform].join(" | "));
}
show("before");
show("before, again");
${text}
show("after");
show("after, again");
console.log(JSON.stringify([Object.getOwnPropertyDescriptor(process, "platform"), Object.getOwnPropertyDescriptor(process, "arch")]));
`,
  },
});

const writtenOut = `function describe() {
  if (process.platform === "${elsewhere}") return "${branchForAnotherPlatform}";
  return "${branchForThisPlatform}";
}
function show(when) {
  console.log(when + ": " + [process.platform, process.arch, process["platform"], (process).arch, process.platform === "${here}", describe(), typeof process.platform, process.platform.length].join(" | "));
}
`;

const programs: Record<string, Program> = {
  "written out": {
    files: {
      "main.mjs": `${writtenOut}show("once");
show("again");
`,
    },
  },

  "written out, in a program that assigns": {
    reference: "compiled",
    files: {
      "main.mjs": `${writtenOut}show("before");
process.platform = "made up";
process.arch = "made up";
show("after an assignment");
console.log(globalThis.process.platform, globalThis.process.arch);
Object.defineProperty(process, "platform", { value: "${elsewhere}" });
show("after Object.defineProperty");
console.log(globalThis.process.platform, globalThis.process.arch);
`,
    },
  },

  "written out in typed code": {
    files: {
      "tsconfig.json": tsconfig,
      "main.ts": `function describe(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  if (process.platform === "linux") return "linux";
  return "another: " + process.platform;
}
const platform: NodeJS.Platform = process.platform;
const arch: NodeJS.Architecture = process.arch;
console.log(describe(), platform, arch, platform === process.platform, \`\${process.platform}-\${process.arch}\`, process.platform.toUpperCase());
export {};
`,
    },
  },

  "typed code": {
    files: {
      "tsconfig.json": tsconfig,
      "main.ts": `function describe(): string {
  const { platform } = process;
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "mac";
  if (platform === "linux") return "linux";
  return "another: " + platform;
}
function separator(host: NodeJS.Process): string {
  return host.platform === "win32" ? ";" : ":";
}
const names: Partial<Record<NodeJS.Platform, string>> = { darwin: "mac", linux: "linux", win32: "windows" };
function lookedUp(): string {
  const { platform } = process;
  return names[platform] ?? "not listed";
}
function wordSize(): number {
  const { arch } = process;
  return arch === "x64" || arch === "arm64" ? 64 : 32;
}
function show(when: string): void {
  const { platform } = process;
  try {
    console.log(when + ": " + [describe(), separator(process), lookedUp(), wordSize(), platform.length, platform.toUpperCase()].join(" | "));
  } catch (error) {
    console.log(when + ": " + (error as Error).name);
  }
}
show("before");
show("before, again");
(process as any).platform = "made up";
(process as any).arch = "made up";
show("after an assignment");
(process as any).platform = "win32";
show("after assigning win32");
(process as any).platform = 5;
show("after assigning a number");
export {};
`,
    },
  },

  "typed code that changes nothing": {
    files: {
      "tsconfig.json": tsconfig,
      "main.ts": `function describe(host: NodeJS.Process): string {
  const { platform, arch } = host;
  if (platform === "win32") return "windows on " + arch;
  if (platform === "darwin") return "mac on " + arch;
  if (platform === "linux") return "linux on " + arch;
  return platform + " on " + arch;
}
console.log(describe(process), describe(globalThis.process));
export {};
`,
    },
  },

  "node:process and node:os": {
    files: {
      "main.mjs": `import os from "node:os";
import processModule, { arch, platform } from "node:process";
function show(when) {
  console.log(when + ": " + [platform, arch, processModule.platform, processModule.arch, processModule === process, os.platform(), os.arch(), process.release.name].join(" | "));
}
show("before");
process.platform = "made up";
process.arch = "made up";
show("after");
`,
    },
  },

  "a worker started by a main thread that assigns": {
    files: {
      "main.mjs": `import { Worker } from "node:worker_threads";
import { describe } from "./shared.mjs";
console.log("main thread: " + describe());
process.platform = "made up";
process.arch = "made up";
console.log("main thread, after an assignment: " + describe());
console.log("worker: " + (await new Promise((resolve, reject) => {
  const worker = new Worker("./worker.mjs");
  worker.once("message", resolve);
  worker.once("error", reject);
})));
console.log("main thread, after the worker: " + describe());
`,
      "worker.mjs": `import { parentPort } from "node:worker_threads";
import { describe } from "./shared.mjs";
const before = describe();
process.platform = "made up in the worker";
parentPort.postMessage(before + ", then " + describe());
`,
      "shared.mjs": `export function describe() {
  const { platform, arch } = process;
  return platform + "/" + arch + "/" + (platform === "${here}");
}
`,
    },
  },
};

const ways: Record<string, string[]> = {
  "by default": [],
  "in a validating build": [buildFlags.validate],
  "without flow results": [buildFlags.withoutFlowResults],
};
// A debug or ASAN build of Bun is many times slower.
const chosenWays = Object.keys(ways).slice(0, wanted === "quick" ? 1 : undefined);

const entryPointsOf = (files: Record<string, string>) => Object.keys(files).filter(name => /^(main|worker)\./.test(name)).sort();
const executableIn = (folder: string, name: string) => join(folder, name + (isWindows ? ".exe" : ""));

async function compile(folder: string, files: Record<string, string>, flags: string[]) {
  const executable = executableIn(folder, "program");
  built(await spawned([bunExe(), ...compileCommand, ...flags, ...entryPointsOf(files), "--outfile", executable], folder, bunEnv));
  return { executable };
}

async function runReference(folder: string, { files, reference }: Program) {
  if (reference !== "compiled") return spawned([bunExe(), "run", entryPointsOf(files)[0]], folder, bunEnv);
  using dotted = tempDir("aot-process-platform-reference", Object.fromEntries(Object.entries(files).map(([name, text]) => [name, text.replaceAll(/\bprocess\["(platform|arch)"\]/g, "process.$1")])));
  const executable = executableIn(String(dotted), "reference");
  built(await spawned([bunExe(), "build", "--compile", ...entryPointsOf(files), "--outfile", executable], String(dotted), bunEnv));
  return await spawned([executable], String(dotted), bunEnv);
}

async function expectOutputOfReference(program: Program, flags: string[]) {
  using dir = tempDir("aot-process-platform", program.files);
  const folder = String(dir);
  const expected = await runReference(folder, program);
  expect({ signal: expected.signal, exitCode: expected.exitCode, stderr: expected.stderr, printsNothing: expected.stdout === "" }).toEqual({ signal: null, exitCode: 0, stderr: "", printsNothing: false });
  const { executable } = await compile(folder, program.files, flags);
  const tripwire = program.evaluatesStrings ? {} : { [runtimeEnvironment.forbidsInterpreter]: "1" };
  const compiled = await spawned(withoutCoreDump([executable]), folder, { ...bunEnv, ...tripwire });
  expect({ signal: compiled.signal, ...told(compiled) }).toEqual({ signal: null, ...told(expected) });
}

async function expectChangeRefused(program: Program, flags: string[]) {
  using dir = tempDir("aot-process-platform", program.files);
  const folder = String(dir);
  const { executable } = await compile(folder, program.files, flags);
  const compiled = await spawned(withoutCoreDump([executable]), folder, bunEnv);
  const shown = (when: string) => compiled.stdout.split("\n").find(line => line.startsWith(when + ": "))?.slice(when.length);
  expect({ signal: compiled.signal, before: shown("before") }).toEqual({ signal: null, before: expect.stringContaining(here) });
  if (compiled.exitCode) expect(compiled.stderr).toContain("Cannot assign to process.platform because built-in objects are read-only");
  else expect(shown("after")).toBe(shown("before"));
}

group("compile/aot/process.platform and process.arch", () => {
  for (const [name, program] of Object.entries(programs)) {
    for (const way of chosenWays) test(`${name}, ${way}`, () => slot(() => expectOutputOfReference(program, ways[way])), 600_000);
  }
});

group("compile/aot/process.platform and process.arch/changed by", () => {
  for (const [name, change] of Object.entries(changes).filter((_, index) => index % 2 === halfOfChanges)) {
    for (const way of chosenWays) {
      // Without flow results no read is folded.
      const expectOutput = change.isUnseen && way !== "without flow results" ? expectChangeRefused : expectOutputOfReference;
      test(`${name}, ${way}`, () => slot(() => expectOutput(programThatChanges(change), ways[way])), 600_000);
    }
  }
});

// One function's IR after instruction selection. A read that is still by name has the name as its key.
async function selectedCodeOf(functionName: string, { files }: Program) {
  using dir = tempDir("aot-process-platform-code", files);
  await compile(String(dir), files, [writesProgramInto(String(dir))]);
  const code = await printIR(String(dir), { until: "Select", functionName });
  expect(code).toContain(`name="${functionName}"`);
  return code;
}

group("compile/aot/process.platform and process.arch/at build time", () => {
  testOfIR("the reads fold and the branch for another platform is removed if nothing changes the properties", () =>
    slot(async () => {
      const program = programThatChanges(changes["nothing"]);
      expect(await selectedCodeOf("platformName", program)).not.toContain(`"platform"`);
      expect(await selectedCodeOf("archName", program)).not.toContain(`"arch"`);
      const branch = await selectedCodeOf("branch", program);
      expect(branch).toContain(branchForThisPlatform);
      expect(branch).not.toContain(branchForAnotherPlatform);
      expect(branch).not.toContain(`"platform"`);
    }), 600_000);

  testOfIR("the same in a program that never mentions this platform's name", () =>
    slot(async () => {
      const branch = await selectedCodeOf("branch", {
        files: {
          "main.mjs": `function branch() {
  const { platform } = process;
  if (platform === "${elsewhere}") return "${branchForAnotherPlatform}";
  return "${branchForThisPlatform}";
}
console.log(new CustomEvent("opaque", { detail: branch }).detail());
`,
        },
      });
      expect(branch).toContain(branchForThisPlatform);
      expect(branch).not.toContain(branchForAnotherPlatform);
      expect(branch).not.toContain(`"platform"`);
    }), 600_000);

  testOfIR("the reads and both branches stay if the program assigns to the properties", () =>
    slot(async () => {
      const program = programThatChanges(changes["an assignment"]);
      expect(await selectedCodeOf("platformName", program)).toContain(`"platform"`);
      expect(await selectedCodeOf("archName", program)).toContain(`"arch"`);
      const branch = await selectedCodeOf("branch", program);
      expect(branch).toContain(branchForThisPlatform);
      expect(branch).toContain(branchForAnotherPlatform);
    }), 600_000);
});

/** Each group has a test file of its own, process-platform-folds-<part>.test.ts, and the second has two: a test is a build or several, and a file has five minutes. */
export function processPlatformFolds(part: number) {
  const [name, body] = groups[[0, 1, 1, 2][part - 1]];
  halfOfChanges = part === 3 ? 1 : 0;
  describe.concurrent(name, body);
}
