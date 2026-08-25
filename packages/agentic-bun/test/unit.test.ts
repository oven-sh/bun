import { describe, expect, test } from "bun:test";
import { compareVersions, parseLaunchHelp, parseModels, parseVersion, type CaptureResult } from "../src/ollama.ts";
import { buildAgentPrompt, buildPlannerPrompt, extractTaskList, toSpecs } from "../src/plan.ts";
import { buildCommand, buildEnv, type RunnerOptions } from "../src/runner.ts";
import { parseArgs } from "../src/cli.ts";

function runnerOptions(overrides: Partial<RunnerOptions> = {}): RunnerOptions {
  return {
    ollamaBinary: "/usr/bin/ollama",
    claudeBinary: "/usr/bin/claude",
    useLaunch: true,
    supportsModelFlag: true,
    supportsYesFlag: true,
    model: "qwen2.5-coder:7b",
    cwd: "/repo",
    extraClaudeArgs: [],
    concurrency: 2,
    timeoutMs: 1000,
    ollamaHost: "http://localhost:11434",
    capture: false,
    color: false,
    ...overrides,
  };
}

function help(text: string, exitCode = 0): CaptureResult {
  return { exitCode, stdout: text, stderr: "", output: text };
}

describe("ollama probe parsing", () => {
  test("parses the version out of ollama's banner", () => {
    expect(parseVersion("ollama version is 0.15.2")).toBe("0.15.2");
    expect(parseVersion("client version is 0.14.3-rc1")).toBe("0.14.3");
    expect(parseVersion("no numbers here")).toBeNull();
  });

  test("compares dotted versions", () => {
    expect(compareVersions("0.15.2", "0.14.0")).toBe(1);
    expect(compareVersions("0.13.9", "0.14.0")).toBe(-1);
    expect(compareVersions("0.14.0", "0.14.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });

  test("reads model names from `ollama list`", () => {
    const output = [
      "NAME\tID\tSIZE\tMODIFIED",
      "qwen2.5-coder:7b\tabc\t4.7 GB\t2 days ago",
      "glm-4.7-flash\tdef\t3.1 GB\t1 week ago",
      "",
    ].join("\n");
    expect(parseModels(output)).toEqual(["qwen2.5-coder:7b", "glm-4.7-flash"]);
  });

  test("detects launch flags from help text", () => {
    const caps = parseLaunchHelp(
      help(
        [
          "Usage: ollama launch [flags] <app>",
          "  --model string  model to use",
          "  --yes           skip selectors",
          "  --              args after this go to the app",
        ].join("\n"),
      ),
    );
    expect(caps).toMatchObject({
      supported: true,
      supportsModelFlag: true,
      supportsYesFlag: true,
      supportsPassthrough: true,
    });
  });

  test("notices flags that a future ollama might drop", () => {
    const caps = parseLaunchHelp(help("Usage: ollama launch <app>\n  --config   configure only\n"));
    expect(caps.supported).toBe(true);
    expect(caps.supportsModelFlag).toBe(false);
    expect(caps.supportsYesFlag).toBe(false);
  });

  test("treats an unknown subcommand as unsupported", () => {
    expect(parseLaunchHelp(help('Error: unknown command "launch" for "ollama"', 1)).supported).toBe(false);
    expect(parseLaunchHelp(help("", 1)).supported).toBe(false);
  });
});

describe("command construction", () => {
  test("wraps the prompt in `ollama launch claude -- -p`", () => {
    expect(buildCommand("do the thing", runnerOptions())).toEqual([
      "/usr/bin/ollama",
      "launch",
      "claude",
      "--model",
      "qwen2.5-coder:7b",
      "--yes",
      "--",
      "-p",
      "do the thing",
    ]);
  });

  test("omits flags the installed ollama does not advertise", () => {
    const cmd = buildCommand("x", runnerOptions({ supportsModelFlag: false, supportsYesFlag: false }));
    expect(cmd).toEqual(["/usr/bin/ollama", "launch", "claude", "--", "-p", "x"]);
  });

  test("forwards permission mode and passthrough args to claude", () => {
    const cmd = buildCommand("x", runnerOptions({ permissionMode: "acceptEdits", extraClaudeArgs: ["--verbose"] }));
    expect(cmd.slice(cmd.indexOf("--"))).toEqual(["--", "-p", "x", "--permission-mode", "acceptEdits", "--verbose"]);
  });

  test("direct mode calls claude itself and points it at the ollama host", () => {
    const opts = runnerOptions({ useLaunch: false });
    expect(buildCommand("x", opts)).toEqual(["/usr/bin/claude", "-p", "x", "--model", "qwen2.5-coder:7b"]);
    expect(buildEnv(opts)).toMatchObject({ ANTHROPIC_BASE_URL: "http://localhost:11434" });
  });

  test("launch mode does not rewrite the anthropic env vars", () => {
    expect(buildEnv(runnerOptions()).ANTHROPIC_BASE_URL).toBe(process.env.ANTHROPIC_BASE_URL);
  });
});

describe("prompts", () => {
  const specs = toSpecs(["write the parser", "write the tests", "update the docs"]);

  test("tells each agent what the others own", () => {
    const prompt = buildAgentPrompt({ goal: "ship the feature", cwd: "/repo", spec: specs[1], index: 1, all: specs });
    expect(prompt).toContain("agent 2 of 3");
    expect(prompt).toContain("ship the feature");
    expect(prompt).toContain("write the tests");
    expect(prompt).toContain("write the parser");
    expect(prompt).toContain("update the docs");
    expect(prompt).toContain("Work inside /repo");
    expect(prompt).toContain("do not commit or push");
  });

  test("skips the coordination section for a single agent", () => {
    const one = toSpecs(["do it"]);
    const prompt = buildAgentPrompt({ goal: "do it", cwd: "/repo", spec: one[0], index: 0, all: one });
    expect(prompt).not.toContain("agent 1 of 1");
    expect(prompt).toContain("Task: do it");
  });

  test("planner prompt asks for a fixed-size JSON array", () => {
    expect(buildPlannerPrompt("ship it", 3, "/repo")).toContain("exactly 3");
  });
});

describe("plan parsing", () => {
  test("reads a bare JSON array", () => {
    expect(extractTaskList('["one", "two"]')).toEqual(["one", "two"]);
  });

  test("reads a JSON array surrounded by chatter or fences", () => {
    expect(extractTaskList('Sure!\n```json\n["one", "two"]\n```\nHope that helps.')).toEqual(["one", "two"]);
  });

  test("falls back to numbered or bulleted lines", () => {
    expect(extractTaskList("1. first task\n2) second task\n- third task")).toEqual([
      "first task",
      "second task",
      "third task",
    ]);
  });

  test("returns nothing for unusable output", () => {
    expect(extractTaskList("I cannot help with that.")).toEqual([]);
  });
});

describe("argument parsing", () => {
  test("collects repeated tasks and splits passthrough args", () => {
    const opts = parseArgs([
      "-g",
      "goal",
      "-t",
      "a",
      "-t",
      "b",
      "--json",
      "--",
      "--verbose",
      "--permission-mode",
      "auto",
    ]);
    expect(opts.goal).toBe("goal");
    expect(opts.tasks).toEqual(["a", "b"]);
    expect(opts.json).toBe(true);
    expect(opts.extraClaudeArgs).toEqual(["--verbose", "--permission-mode", "auto"]);
  });

  test("accepts --flag=value", () => {
    const opts = parseArgs(["--goal=ship it", "--agents=3", "--model=glm-4.7-flash"]);
    expect(opts.goal).toBe("ship it");
    expect(opts.agents).toBe(3);
    expect(opts.model).toBe("glm-4.7-flash");
  });

  test("rejects bad input", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option/);
    expect(() => parseArgs(["--agents", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--agents", "99"])).toThrow(/<= 16/);
    expect(() => parseArgs(["--goal"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--plan", "-t", "a"])).toThrow(/mutually exclusive/);
  });
});
