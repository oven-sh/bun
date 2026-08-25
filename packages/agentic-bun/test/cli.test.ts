/**
 * End-to-end tests for the dispatcher. Ollama is not installed in CI, so a stub
 * `ollama` (test/fixtures/ollama-stub.sh) stands in for it: it answers
 * --version/list/launch --help like the real CLI and records the argv of every
 * launch so we can assert on the exact command the dispatcher built.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../test/harness.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const STUB = join(import.meta.dir, "fixtures", "ollama-stub.sh");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  dir: string;
}

/** Runs the CLI with a stubbed `ollama` (and `claude`) ahead of it on PATH. */
async function runCli(args: string[], fake: Record<string, string> = {}, stdin?: string): Promise<RunResult> {
  const dir = tempDir("agentic-bun", {});
  const binDir = join(String(dir), "bin");
  mkdirSync(binDir, { recursive: true });
  for (const name of ["ollama", "claude"]) {
    copyFileSync(STUB, join(binDir, name));
    chmodSync(join(binDir, name), 0o755);
  }

  await using proc = Bun.spawn({
    cmd: [process.execPath, CLI, ...args],
    cwd: String(dir),
    env: {
      ...process.env,
      // binDir first so the stubs shadow anything real on this machine.
      PATH: `${binDir}:${process.env.PATH}`,
      NO_COLOR: "1",
      FAKE_DIR: String(dir),
      FAKE_MODELS: "qwen2.5-coder:7b",
      ...fake,
    },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, dir: String(dir) };
}

/** Every `ollama launch` argv the stub recorded, oldest first. */
function invocations(dir: string): string[][] {
  return readdirSync(dir)
    .filter(name => name.startsWith("inv-") && name.endsWith(".args"))
    .map(name => join(dir, name))
    .map(path => readFileSync(path, "utf8").split("\x1e").slice(0, -1));
}

describe("preflight", () => {
  test("explains how to fix a missing ollama", async () => {
    const dir = tempDir("agentic-bun-empty", {});
    mkdirSync(join(String(dir), "bin"), { recursive: true });
    await using proc = Bun.spawn({
      cmd: [process.execPath, CLI, "-t", "do a thing"],
      env: { ...process.env, PATH: join(String(dir), "bin") },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("`ollama` was not found on PATH");
    expect(exitCode).toBe(1);
  });

  test("explains how to fix an ollama without `launch`", async () => {
    const result = await runCli(["-t", "do a thing"], { FAKE_NO_LAUNCH: "1" });
    expect(result.stderr).toContain("`ollama launch` is not available");
    expect(result.exitCode).toBe(1);
  });

  test("warns about an old ollama but still runs", async () => {
    const result = await runCli(["-t", "do a thing"], { FAKE_VERSION: "0.13.1" });
    expect(result.stderr).toContain("0.14.0+ is recommended");
    expect(result.exitCode).toBe(0);
  });

  test("rejects a working directory that does not exist", async () => {
    const result = await runCli(["-t", "do a thing", "-C", "/definitely/not/here"]);
    expect(result.stderr).toContain("/definitely/not/here is not a directory");
    expect(result.exitCode).toBe(1);
  });

  test("refuses to guess when stdin is not a terminal and no goal was given", async () => {
    const result = await runCli([]);
    expect(result.stderr).toContain("a goal is required");
    expect(result.exitCode).toBe(1);
  });
});

describe("dry run", () => {
  test("prints the exact command each agent would run", async () => {
    const result = await runCli(["--dry-run", "-t", "write the docs", "-t", "add a benchmark"]);
    expect(result.stdout).toContain("ollama launch claude --model qwen2.5-coder:7b --yes --");
    expect(result.stdout).toContain("# a1: write the docs");
    expect(result.stdout).toContain("# a2: add a benchmark");
    expect(result.exitCode).toBe(0);
    expect(invocations(result.dir)).toHaveLength(0);
  });

  test("drops --model/--yes when the installed ollama lacks them", async () => {
    const result = await runCli(["--dry-run", "-t", "x"], { FAKE_NO_YES_FLAG: "1", FAKE_NO_MODEL_FLAG: "1" });
    expect(result.stdout).not.toContain("--yes");
    expect(result.stdout).not.toContain("--model");
    expect(result.stderr).toContain("does not advertise --yes");
  });

  test("passes our own trailing args through to claude", async () => {
    const result = await runCli(["--dry-run", "-t", "x", "--permission-mode", "acceptEdits", "--", "--verbose"]);
    expect(result.stdout).toContain("--permission-mode acceptEdits --verbose");
  });

  test("--direct bypasses ollama launch", async () => {
    const result = await runCli(["--dry-run", "--direct", "-t", "x"]);
    expect(result.stdout).toContain("/claude -p ");
    expect(result.stdout).not.toContain("ollama launch");
  });
});

describe("running agents", () => {
  test("streams every agent's output with its own prefix", async () => {
    const result = await runCli(["-t", "write the docs", "-t", "add a benchmark"], { FAKE_STDOUT: "did the work" });
    expect(result.stdout).toContain("[a1] did the work");
    expect(result.stdout).toContain("[a2] did the work");
    expect(result.stderr).toContain("2/2 agents succeeded.");
    expect(result.exitCode).toBe(0);

    const args = invocations(result.dir);
    expect(args).toHaveLength(2);
    for (const argv of args) {
      expect(argv.slice(0, 6)).toEqual(["launch", "claude", "--model", "qwen2.5-coder:7b", "--yes", "--"]);
      expect(argv[6]).toBe("-p");
    }
    // Each agent is told its own task and the other agent's task.
    const prompts = args.map(argv => argv[7]).sort();
    expect(prompts[0]).toContain("agent 1 of 2");
    expect(prompts[0]).toContain("write the docs");
    expect(prompts[0]).toContain("add a benchmark");
  });

  test("reports a failing agent and exits non-zero", async () => {
    const result = await runCli(["-t", "break something"], { FAKE_EXIT: "7", FAKE_STDERR: "boom" });
    expect(result.stderr).toContain("[a1] boom");
    expect(result.stderr).toContain("exit 7");
    expect(result.stderr).toContain("0/1 agents succeeded.");
    expect(result.exitCode).toBe(1);
  });

  test("--json captures output instead of streaming it", async () => {
    const result = await runCli(["--json", "-g", "ship it", "-t", "one", "-t", "two"], { FAKE_STDOUT: "done" });
    expect(result.stdout).not.toContain("[a1]");
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.goal).toBe("ship it");
    expect(report.model).toBe("qwen2.5-coder:7b");
    expect(report.agents).toHaveLength(2);
    expect(report.agents[0]).toMatchObject({ id: "a1", task: "one", exitCode: 0, timedOut: false });
    expect(report.agents[0].stdout).toContain("done");
    expect(result.exitCode).toBe(0);
  });

  test("kills an agent that overruns --timeout", async () => {
    const result = await runCli(["--json", "-t", "hang", "--timeout", "1"], {
      FAKE_PEERS: "2",
      FAKE_PEER_WAIT_MS: "10000",
    });
    const report = JSON.parse(result.stdout);
    expect(report.agents[0].timedOut).toBe(true);
    expect(report.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe("concurrency", () => {
  // The stub blocks until FAKE_PEERS agents are alive at once, so these two tests
  // prove parallelism (and its absence) without depending on timing.
  test("runs agents in parallel up to the concurrency limit", async () => {
    const result = await runCli(["-t", "one", "-t", "two"], { FAKE_PEERS: "2" });
    expect(result.stderr).toContain("concurrency 2");
    expect(result.stderr).toContain("2/2 agents succeeded.");
    expect(result.exitCode).toBe(0);
  });

  test("--concurrency 1 serializes them", async () => {
    const result = await runCli(["-c", "1", "-t", "one", "-t", "two"], { FAKE_PEERS: "2", FAKE_PEER_WAIT_MS: "500" });
    // Neither agent ever sees a peer, so the stub gives up with exit 3.
    expect(result.stderr).toContain("concurrency 1");
    expect(result.stderr).toContain("exit 3");
    expect(result.stderr).toContain("0/2 agents succeeded.");
  });
});

describe("planning", () => {
  test("asks the model to split the goal, then runs one agent per task", async () => {
    const plan = JSON.stringify(["parse the input", "render the output", "write the tests"]);
    const result = await runCli(["-g", "build the thing", "-n", "3"], { FAKE_PLAN: plan });

    expect(result.stderr).toContain("Splitting the goal into 3 tasks");
    expect(result.stderr).toContain("3/3 agents succeeded.");
    expect(result.exitCode).toBe(0);

    const args = invocations(result.dir);
    expect(args).toHaveLength(4); // one planner call + three agents
    const prompts = args.map(argv => argv[argv.indexOf("-p") + 1]);
    expect(prompts.some(p => p.includes("exactly 3"))).toBe(true);
    for (const task of ["parse the input", "render the output", "write the tests"]) {
      expect(prompts.filter(p => p.includes(task))).not.toHaveLength(0);
    }
  });

  test("fails loudly when the model does not return a task list", async () => {
    const result = await runCli(["-g", "build the thing", "-n", "2"], { FAKE_PLAN: "I cannot help with that." });
    expect(result.stderr).toContain("could not read a task list");
    expect(result.stderr).toContain("Pass --task explicitly");
    expect(result.exitCode).toBe(1);
  });
});

describe("wizard", () => {
  test("asks for the goal, directory, agent count and tasks", async () => {
    const answers =
      ["add tests for the parser", "", "2", "cover the happy path", "cover the error path", ""].join("\n") + "\n";
    const result = await runCli(["--dry-run"], {}, answers);

    expect(result.stderr).toContain("What do you want done?");
    expect(result.stderr).toContain("How many agents should run in parallel?");
    expect(result.stdout).toContain("# a1: cover the happy path");
    expect(result.stdout).toContain("# a2: cover the error path");
    expect(result.exitCode).toBe(0);
  });

  test("offers a numbered model list when several are installed", async () => {
    const answers = ["ship it", "", "1", "2"].join("\n") + "\n";
    const result = await runCli(["--dry-run"], { FAKE_MODELS: "qwen2.5-coder:7b glm-4.7-flash" }, answers);

    expect(result.stderr).toContain("1. qwen2.5-coder:7b");
    expect(result.stderr).toContain("2. glm-4.7-flash");
    expect(result.stdout).toContain("--model glm-4.7-flash");
  });

  test("keeps stdout free of wizard chatter", async () => {
    const result = await runCli(["--json", "-t", "one"], { FAKE_STDOUT: "done" }, "");
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  test("-y skips the wizard entirely", async () => {
    const result = await runCli(["-y", "--dry-run"], {}, "should never be read\n");
    expect(result.stderr).not.toContain("What do you want done?");
    expect(result.stderr).toContain("a goal is required");
    expect(result.exitCode).toBe(1);
  });
});
