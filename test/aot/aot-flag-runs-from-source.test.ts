import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

setDefaultTimeout(120_000);

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    noEmit: true,
    types: [],
  },
});
const declarations = `declare const console: { log(...values: unknown[]): void };\ndeclare const process: { execArgv: string[]; argv: string[] };\n`;

async function spawned(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await run(cmd, cwd, { ...bunEnv, ...env });
  return { stdout, stderr, exitCode };
}
const bun = (cwd: string, ...args: string[]) => spawned([bunExe(), ...args], cwd, { BUN_AOT_VERBOSE: "1" });
const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();

describe("which code runs", () => {
  const files = {
    "tsconfig.json": tsconfig,
    "main.ts": declarations + `console.log("ran", process.execArgv.join(" "));`,
  };
  test("--aot loads no compiled code, --debug-aot does", async () => {
    using dir = tempDir("aot-flag-runs-from-source", files);
    const checked = await bun(String(dir), "run", "--aot", "main.ts");
    expect({ stdout: checked.stdout, exitCode: checked.exitCode }).toEqual({ stdout: "ran --aot\n", exitCode: 0 });
    expect(checked.stderr).not.toContain("[aot] image: ");
    const compiled = await bun(String(dir), "run", "--debug-aot", "main.ts");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: "ran --debug-aot\n",
      exitCode: 0,
    });
    expect(compiled.stderr).toContain("[aot] image: ");
  });
  test("--aot ends the build behind what it reports about the program, and generates no code", async () => {
    using dir = tempDir("aot-flag-runs-from-source", files);
    const stages = (said: string) => [
      ...new Set([...said.matchAll(/^AOT phase times: (\w+) \|/gm)].map(match => match[1])),
    ];
    const checked = await spawned([bunExe(), "run", "--aot", "main.ts"], String(dir), {
      BUN_JSC_logAOTPhaseTimes: "1",
    });
    expect(stages(checked.stderr)).toContain("AnalyzeFlow");
    for (const later of ["Optimize", "Select", "GenerateCode"]) expect(stages(checked.stderr)).not.toContain(later);
    expect(checked.stdout).toBe("ran --aot\n");
    const compiled = await spawned([bunExe(), "run", "--debug-aot", "main.ts"], String(dir), {
      BUN_JSC_logAOTPhaseTimes: "1",
    });
    expect(stages(compiled.stderr)).toContain("GenerateCode");
  });
  test("bun test --aot loads no compiled code", async () => {
    using dir = tempDir("aot-flag-runs-from-source", {
      "tsconfig.json": tsconfig,
      "one.test.ts": `import { expect, test } from "bun:test";\ntest("one", () => { expect(1).toBe(1); });`,
    });
    const checked = await bun(String(dir), "test", "--aot");
    expect(passed(checked.stderr)).toEqual(["one"]);
    expect(checked.stderr).not.toContain("[aot] image: ");
    expect(checked.exitCode).toBe(0);
    expect((await bun(String(dir), "test", "--debug-aot")).stderr).toContain("[aot] image: ");
  });
});

describe("what stops a build stops the run, and is printed as the build prints it", () => {
  const stopped: Record<string, { text: string; code: string }> = {
    "a type error": { text: `console.log("ran"); const port: number = "8080"; console.log(port);`, code: "TS2322" },
    "an import that does not resolve": { text: `console.log("ran"); import("./nowhere.ts");`, code: "TS2307" },
    "a store to a built-in that always runs": {
      text: `console.log("ran"); (Array.prototype as any).push = () => 0;`,
      code: "TS100014",
    },
    "an invalid regular expression": { text: `console.log("ran"); console.log(/(/.source);`, code: "TS1005" },
  };
  test.concurrent.each(Object.keys(stopped))("%s", async name => {
    using dir = tempDir("aot-flag-runs-from-source", {
      "tsconfig.json": tsconfig,
      "main.ts": declarations + stopped[name].text,
    });
    const errors = (said: string) => said.split("\n").filter(line => line.startsWith("error: "));
    const built = await bun(
      String(dir),
      "build",
      "--compile",
      "--aot",
      "main.ts",
      "--outfile",
      join(String(dir), "program"),
    );
    expect(errors(built.stderr).join("\n")).toContain(stopped[name].code);
    expect(built.exitCode).toBe(1);
    const ran = await bun(String(dir), "run", "--aot", "main.ts");
    expect(errors(ran.stderr)).toEqual(errors(built.stderr));
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
});

describe("the built-ins that a compiled program cannot change", () => {
  const writes = `
    const attempt = (name, change) => { try { console.log(name, "=>", String(change())); } catch (error) { console.log(name, "throws", error.name + ": " + error.message); } };
    export function all(where) {
      console.log(where);
      attempt("a method of Array.prototype", () => { Array.prototype.push = () => 0; return [].push(1); });
      attempt("a function of Math", () => { Math.ceil = () => 7; return Math.ceil(1.5); });
      attempt("a new name on Math", () => { Math.added = () => 7; return Math.added(); });
      attempt("Math.random", () => { const kept = Math.random; Math.random = () => 7; const said = Math.random(); Math.random = kept; return said; });
      attempt("a new name on Object.prototype", () => { Object.prototype.added = 1; return ({}).added; });
      attempt("a method of Headers.prototype", () => { Headers.prototype.set = () => 0; return 1; });
      attempt("call on a function of the engine", () => { Math.max.call = () => 0; return Math.max.call(null, 1, 2); });
      attempt("the prototype of Request.prototype", () => typeof Object.setPrototypeOf(Request.prototype, null));
      attempt("delete", () => delete String.prototype.trimStart === false);
      attempt("defineProperty", () => typeof Object.defineProperty(Map.prototype, "get", { value: () => 0 }));
      attempt("Reflect.set", () => Reflect.set(Set.prototype, "has", () => true));
      attempt("the binding Array", () => { globalThis.Array = Object; return Array === Object; });
      attempt("the value that the member holds", () => { Object.assign = Object.assign; return "stored"; });
    }
    export function often() {
      const seen = {};
      for (let i = 0; i < 100000; i++) { let said; try { Array.prototype.pop = often; said = "stored"; } catch (error) { said = error.name; } seen[said] = (seen[said] ?? 0) + 1; }
      console.log("in a hot loop", JSON.stringify(seen));
    }
  `;
  const files = {
    "writes.mjs": writes,
    "main.mjs": `import { all, often } from "./writes.mjs"; all("main"); often();`,
    "with-worker.mjs": `new Worker(new URL("./in-worker.mjs", import.meta.url).href);`,
    "in-worker.mjs": `import { all } from "./writes.mjs"; all("worker");`,
    "other-realms.mjs": `
      import vm from "node:vm";
      console.log("node:vm", vm.runInNewContext("Array.prototype.push = () => 7; [].push(1)"));
      console.log("ShadowRealm", new ShadowRealm().evaluate("Array.prototype.push = () => 7; [].push(1)"));`,
  };
  const withoutWarnings = (said: { stdout: string; exitCode: number }) => ({
    stdout: said.stdout,
    exitCode: said.exitCode,
  });

  test.concurrent.each(["main.mjs", "with-worker.mjs", "other-realms.mjs"])(
    "%s prints under --aot what the executable prints",
    async entry => {
      using dir = tempDir("aot-flag-runs-from-source", files);
      const executable = join(String(dir), isWindows ? "program.exe" : "program");
      const entries = entry === "with-worker.mjs" ? [entry, "in-worker.mjs"] : [entry];
      const built = await bun(String(dir), "build", "--compile", "--aot", ...entries, "--outfile", executable);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const compiled = withoutWarnings(await spawned([executable], String(dir)));
      expect(compiled.exitCode).toBe(0);
      expect(withoutWarnings(await bun(String(dir), "run", "--aot", entry))).toEqual(compiled);
      const plain = withoutWarnings(await bun(String(dir), "run", entry));
      if (entry === "other-realms.mjs") expect(plain).toEqual(compiled);
      else expect(plain.stdout).not.toBe(compiled.stdout);
    },
  );
});

describe("what the program itself has put on the global object", () => {
  test("hot code stores to a property that was deleted as it does under bun run", async () => {
    const folder = join(import.meta.dir, "programs", "language");
    const program = "a-strict-store-to-a-global-that-was-deleted-throws-in-hot-code.js";
    // The loop waits for each tier, so that the code is compiled when the property goes, however busy the machine is.
    const waitsForTheJIT = { BUN_JSC_useConcurrentJIT: "0" };
    const plain = await spawned([bunExe(), "run", program], folder, waitsForTheJIT);
    expect(plain.stdout).toContain("ReferenceError ReferenceError undefined false");
    expect(await spawned([bunExe(), "run", "--aot", program], folder, waitsForTheJIT)).toEqual(plain);
  });
});

describe("bun test --aot", () => {
  const price = {
    "tsconfig.json": tsconfig,
    "price.ts": `export function price(id: string): number { return id.length; }`,
  };
  const mocked = {
    ...price,
    "one.test.ts": `import { expect, mock, spyOn, test } from "bun:test";\nimport * as all from "./price";\nimport { price } from "./price";
      test("spied", () => { const spy = spyOn(all, "price").mockReturnValue(7); expect(price("abc")).toBe(7); spy.mockRestore(); expect(price("abc")).toBe(3); });
      test("mocked", () => { mock.module("./price", () => ({ price: () => 42 })); expect(price("abc")).toBe(42); });`,
  };
  test("mock.module and a spy on a namespace work", async () => {
    using dir = tempDir("aot-flag-runs-from-source", mocked);
    const { stderr, exitCode } = await bun(String(dir), "test", "--aot");
    expect(passed(stderr)).toEqual(["mocked", "spied"]);
    expect(exitCode).toBe(0);
  });
  test("under --debug-aot they throw, as in an executable", async () => {
    using dir = tempDir("aot-flag-runs-from-source", mocked);
    const { stderr, exitCode } = await bun(String(dir), "test", "--debug-aot");
    expect(stderr).toContain("module exports can't be replaced in a compiled executable");
    expect(stderr).toContain("cannot replace a module that was compiled ahead of time");
    expect(passed(stderr)).toEqual([]);
    expect(exitCode).toBe(1);
  });
  test("a spy goes through the lock and is restored, a store does not", async () => {
    using dir = tempDir("aot-flag-runs-from-source", {
      "tsconfig.json": tsconfig,
      "one.test.ts": `import { expect, spyOn, test } from "bun:test";
        const early = spyOn(String.prototype, "trimEnd");
        early.mockRestore();
        test("spied", () => {
          const original = String.prototype.normalize;
          const spy = spyOn(String.prototype, "normalize").mockReturnValue("spied");
          expect("a".normalize()).toBe("spied");
          expect(() => { (String.prototype as any).normalize = original; }).toThrow(TypeError);
          spy.mockRestore();
          expect(String.prototype.normalize).toBe(original);
          expect("a".normalize()).toBe("a");
          expect(() => { (String.prototype as any).normalize = () => ""; }).toThrow(TypeError);
        });`,
    });
    const { stderr, exitCode } = await bun(String(dir), "test", "--aot");
    expect(passed(stderr)).toEqual(["spied"]);
    expect(stderr).not.toContain("TS100014");
    expect(exitCode).toBe(0);
  });
  const locked = {
    "tsconfig.json": tsconfig,
    "a.test.ts": `import { expect, test } from "bun:test";\ntest("a", () => { expect(() => { (Array.prototype as any).push = () => 0; }).toThrow(TypeError); });`,
    "b.test.ts": `import { expect, test } from "bun:test";\ntest("b", () => { expect(() => { (Array.prototype as any).pop = () => 0; }).toThrow(TypeError); });`,
  };
  test.concurrent.each([["--isolate"], ["--parallel=2"], ["--rerun-each=2"], ["--coverage"]])(
    "%s works, and the built-ins are read-only in every file",
    async flag => {
      using dir = tempDir("aot-flag-runs-from-source", locked);
      const { stdout, stderr, exitCode } = await bun(String(dir), "test", "--aot", flag);
      expect([...new Set(passed(stdout + stderr))]).toEqual(["a", "b"]);
      expect(stdout + stderr).not.toContain("(fail)");
      expect(exitCode).toBe(0);
    },
  );
  test("the version is printed once", async () => {
    using dir = tempDir("aot-flag-runs-from-source", locked);
    const { stdout, stderr } = await bun(String(dir), "test", "--aot");
    expect((stdout + stderr).split("bun test v").length - 1).toBe(1);
  });
});

describe("the debugger", () => {
  const files = {
    "tsconfig.json": tsconfig,
    "main.ts":
      declarations +
      `try { (Math as any).floor = 1; console.log("stored"); } catch (error) { console.log("ran", (error as Error).name); }`,
  };
  const listeners = (said: string) => said.split("Listening:").length - 1;
  test("--inspect-wait starts it once, holds the program until a client attaches, and a debugger statement pauses it", async () => {
    using dir = tempDir("aot-flag-runs-from-source", {
      ...files,
      "main.ts": files["main.ts"] + `\ndebugger;\nconsole.log("resumed");`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", "--aot", "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    let stderr = "";
    const { promise: address, resolve: foundAddress, reject: noAddress } = Promise.withResolvers<string>();
    const drained = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stderr) {
        stderr += decoder.decode(chunk, { stream: true });
        const line = stderr
          .split("\n")
          .slice(0, -1)
          .find(line => line.trim().startsWith("ws://"));
        if (line) foundAddress(line.trim());
      }
      noAddress(new Error("no address of the debugger in stderr:\n" + stderr));
    })();
    let stdout = "";
    const { promise: printedAll, resolve: didPrintAll } = Promise.withResolvers<void>();
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (stdout.endsWith("resumed\n")) didPrintAll();
      }
      didPrintAll();
    })();
    const client = new WebSocket(await address);
    const { promise: paused, resolve: didPause } = Promise.withResolvers<any>();
    const answers = new Map<number, () => void>();
    client.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (typeof message.id === "number") answers.get(message.id)!();
      else if (message.method === "Debugger.paused") didPause(message.params);
    });
    let sent = 0;
    const request = (method: string, params = {}) => {
      const id = ++sent;
      client.send(JSON.stringify({ id, method, params }));
      return new Promise<void>(resolve => answers.set(id, resolve));
    };
    await new Promise(resolve => client.addEventListener("open", resolve));
    await Promise.all([
      request("Inspector.enable"),
      request("Debugger.enable"),
      request("Debugger.setBreakpointsActive", { active: true }),
      request("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
    ]);
    await request("Inspector.initialized");
    const { reason } = await paused;
    const before = stdout;
    await request("Debugger.resume");
    await printedAll;
    // The process stays for as long as a client is attached.
    client.close();
    const exitCode = await proc.exited;
    await drained;
    expect({ reason, before, stdout, listeners: listeners(stderr), exitCode }).toEqual({
      reason: "DebuggerStatement",
      before: "ran TypeError\n",
      stdout: "ran TypeError\nresumed\n",
      listeners: 1,
      exitCode: 0,
    });
  });
  test("BUN_INSPECT starts it once", async () => {
    const waits = `declare const process: { stdin: { once(event: "data", run: () => void): void }; exit(code: number): never };\ndeclare const console: { log(...values: unknown[]): void };\n`;
    using dir = tempDir("aot-flag-runs-from-source", {
      "tsconfig.json": tsconfig,
      "main.ts":
        waits +
        `try { (Math as any).floor = 1; console.log("stored"); } catch (error) { console.log("ran", (error as Error).name); }\nprocess.stdin.once("data", () => process.exit(0));`,
    });
    let ready = 0;
    const { promise: first, resolve: isReady } = Promise.withResolvers<void>();
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { open: () => (ready++, isReady()), data() {} },
    });
    const env = {
      ...bunEnv,
      BUN_INSPECT: "ws://127.0.0.1:0/aot-flag",
      BUN_INSPECT_NOTIFY: `tcp://127.0.0.1:${listener.port}`,
    };
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--aot", "main.ts"],
      cwd: String(dir),
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.race([first, proc.exited]);
    proc.stdin.write("go\n");
    proc.stdin.end();
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, ready, exitCode }).toEqual({ stdout: "ran TypeError\n", ready: 1, exitCode: 0 });
  });
  test("a type error is reported and no debugger starts", async () => {
    using dir = tempDir("aot-flag-runs-from-source", {
      ...files,
      "main.ts": declarations + `const port: number = "8080"; console.log("ran", port);`,
    });
    const { stdout, stderr, exitCode } = await bun(String(dir), "--inspect=127.0.0.1:0", "--aot", "main.ts");
    expect(stderr).toContain("TS2322");
    expect({ stdout, listeners: listeners(stderr), exitCode }).toEqual({ stdout: "", listeners: 0, exitCode: 1 });
  });
});

describe("--watch", () => {
  const value = (text: string) => `export const value: number = ${text};\n`;
  const shape = (side: string) => `export type Shape = { side: ${side} };\n`;
  const files = {
    "tsconfig.json": tsconfig,
    "main.ts":
      declarations +
      `import { value } from "./value";\nimport type { Shape } from "./shape";\nconst shape: Shape = { side: 1 };\nlet locked = "not locked";\n` +
      `try { (Math as any).floor = 1; } catch { locked = "locked"; }\nconsole.log("run", value, shape.side, locked);`,
    "value.ts": value("1"),
    "shape.ts": shape("number"),
  };
  // What a stream has said so far. `until` returns when that holds, and throws if the stream ends first.
  function listen(stream: ReadableStream<Uint8Array>) {
    const heard = { text: "", ended: false };
    let wake = () => {};
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        heard.text += decoder.decode(chunk, { stream: true });
        wake();
      }
      heard.ended = true;
      wake();
    })();
    return {
      heard,
      async until(holds: (text: string) => boolean) {
        while (!holds(heard.text)) {
          if (heard.ended) throw new Error("the stream ended after:\n" + heard.text);
          await new Promise<void>(resolve => (wake = resolve));
        }
      },
    };
  }
  function watch(cwd: string, ...args: string[]) {
    const proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    return { proc, out: listen(proc.stdout), err: listen(proc.stderr), [Symbol.dispose]: () => proc.kill() };
  }
  const count = (text: string, part: string) => text.split(part).length - 1;

  test("a change runs the check again, and a program that is refused waits for the next change", async () => {
    using dir = tempDir("aot-flag-runs-from-source", files);
    using watched = watch(String(dir), "--watch", "--aot", "main.ts");
    await watched.out.until(text => text.endsWith("run 1 1 locked\n"));
    writeFileSync(join(String(dir), "value.ts"), value("2"));
    await watched.out.until(text => text.endsWith("run 2 1 locked\n"));
    writeFileSync(join(String(dir), "value.ts"), value(`"three"`));
    await watched.err.until(text => text.includes("TS2322"));
    writeFileSync(join(String(dir), "value.ts"), value("4"));
    await watched.out.until(text => text.endsWith("run 4 1 locked\n"));
    expect(watched.out.heard.text).toBe("run 1 1 locked\nrun 2 1 locked\nrun 4 1 locked\n");
  });
  test("a file that has only types, which the program never loads, is watched too", async () => {
    using dir = tempDir("aot-flag-runs-from-source", files);
    using watched = watch(String(dir), "--watch", "--aot", "main.ts");
    await watched.out.until(text => text.endsWith("run 1 1 locked\n"));
    writeFileSync(join(String(dir), "shape.ts"), shape("string"));
    await watched.err.until(text => text.includes("TS2322"));
    writeFileSync(join(String(dir), "shape.ts"), shape("number"));
    await watched.out.until(text => count(text, "run 1 1 locked\n") === 2);
    expect(watched.out.heard.text).toBe("run 1 1 locked\nrun 1 1 locked\n");
  });
  test("tsconfig.json is watched too", async () => {
    const options = (strict: boolean) =>
      JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, strict } });
    using dir = tempDir("aot-flag-runs-from-source", {
      "tsconfig.json": options(false),
      "main.ts": declarations + `function twice(x) { return x * 2; }\nconsole.log("run", twice(2));`,
    });
    using watched = watch(String(dir), "--watch", "--aot", "main.ts");
    await watched.out.until(text => text.endsWith("run 4\n"));
    writeFileSync(join(String(dir), "tsconfig.json"), options(true));
    await watched.err.until(text => text.includes("TS7006"));
    writeFileSync(join(String(dir), "tsconfig.json"), options(false));
    await watched.out.until(text => count(text, "run 4\n") === 2);
    expect(watched.out.heard.text).toBe("run 4\nrun 4\n");
  });
  test("a program that is refused at the start waits as well", async () => {
    using dir = tempDir("aot-flag-runs-from-source", { ...files, "value.ts": value(`"one"`) });
    using watched = watch(String(dir), "--watch", "--aot", "main.ts");
    await watched.err.until(text => text.includes("TS2322"));
    writeFileSync(join(String(dir), "value.ts"), value("1"));
    await watched.out.until(text => text.endsWith("run 1 1 locked\n"));
    expect(watched.out.heard.text).toBe("run 1 1 locked\n");
  });
  test("bun test: a test file that is refused is checked again when it changes", async () => {
    const written = (name: string, port: string) =>
      `import { expect, test } from "bun:test";\nconst port: number = ${port};\ntest("${name}", () => { expect(port).toBe(1); });`;
    using dir = tempDir("aot-flag-runs-from-source", {
      "tsconfig.json": tsconfig,
      "a.test.ts": written("a", "1"),
      "b.test.ts": written("b", `"1"`),
    });
    using watched = watch(String(dir), "test", "--watch", "--aot");
    const said = () => watched.out.heard.text + watched.err.heard.text;
    await watched.err.until(() => said().includes("TS2322") && passed(said()).includes("a"));
    expect(passed(said())).toEqual(["a"]);
    writeFileSync(join(String(dir), "b.test.ts"), written("b", "1"));
    await watched.err.until(() => passed(said()).includes("b"));
    expect([...new Set(passed(said()))]).toEqual(["a", "b"]);
  });
  test("--hot starts the process again like --watch, so that nothing runs unchecked", async () => {
    const counts = `\nconst state = globalThis as unknown as { runs?: number };\nstate.runs = (state.runs ?? 0) + 1;\nconsole.log("runs", state.runs);`;
    using dir = tempDir("aot-flag-runs-from-source", { ...files, "main.ts": files["main.ts"] + counts });
    using watched = watch(String(dir), "--hot", "--aot", "main.ts");
    await watched.out.until(text => text.endsWith("run 1 1 locked\nruns 1\n"));
    writeFileSync(join(String(dir), "value.ts"), value("2"));
    await watched.out.until(text => text.endsWith("run 2 1 locked\nruns 1\n"));
    writeFileSync(join(String(dir), "value.ts"), value(`"three"`));
    await watched.err.until(text => text.includes("TS2322"));
    writeFileSync(join(String(dir), "value.ts"), value("4"));
    await watched.out.until(text => text.endsWith("run 4 1 locked\nruns 1\n"));
    expect(watched.out.heard.text).toBe("run 1 1 locked\nruns 1\nrun 2 1 locked\nruns 1\nrun 4 1 locked\nruns 1\n");
  });
});
