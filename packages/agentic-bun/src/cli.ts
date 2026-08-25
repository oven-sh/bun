#!/usr/bin/env bun
/**
 * agentic-bun - fan a goal out to several Claude Code agents running on local
 * Ollama models.
 *
 * Flow: preflight the local ollama install -> ask a handful of plain questions
 * (or take them from flags) -> turn the answers into one prompt per agent ->
 * spawn `ollama launch claude ... -- -p <prompt>` per agent -> stream the
 * output back with a per-agent prefix -> print a summary and exit.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { MIN_OLLAMA_VERSION, probeOllama, type OllamaProbe } from "./ollama.ts";
import { buildAgentPrompt, buildPlannerPrompt, extractTaskList, toSpecs, type AgentSpec } from "./plan.ts";
import { buildCommand, runAgents, type AgentResult, type Job, type RunnerOptions } from "./runner.ts";

const VERSION = "0.1.0";
const DEFAULT_TIMEOUT_SEC = 900;
const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_AGENTS = 16;

interface Options {
  goal: string | null;
  tasks: string[];
  agents: number | null;
  cwd: string;
  model: string | null;
  concurrency: number | null;
  plan: boolean;
  permissionMode: string | null;
  direct: boolean;
  dryRun: boolean;
  json: boolean;
  timeoutSec: number;
  yes: boolean;
  ollamaHost: string;
  extraClaudeArgs: string[];
  help: boolean;
  version: boolean;
}

const HELP = `agentic-bun ${VERSION} - multi-agent dispatcher for \`ollama launch claude\`

Usage:
  agentic-bun [options] [-- <args passed to claude>]

Run with no options to answer a few questions interactively.

Options:
  -g, --goal <text>        Overall objective.
  -t, --task <text>        One agent's task. Repeat for more agents.
  -n, --agents <n>         Number of agents. With no --task, the model splits the goal into this many.
  -C, --cwd <dir>          Directory the agents work in (default: current directory).
  -m, --model <name>       Ollama model. Auto-selected when exactly one is installed.
  -c, --concurrency <n>    Max agents running at once (default: min(agents, ${DEFAULT_MAX_CONCURRENCY})).
      --plan               Do not ask for per-agent tasks; let the model split the goal.
      --permission-mode <m> Forwarded to claude (acceptEdits, bypassPermissions, ...).
      --direct             Skip \`ollama launch\`; run \`claude\` against --ollama-host.
      --ollama-host <url>  Ollama base URL for --direct (default: $OLLAMA_HOST or http://localhost:11434).
      --timeout <sec>      Per-agent timeout (default: ${DEFAULT_TIMEOUT_SEC}).
      --dry-run            Print the commands that would run, then exit.
      --json               Capture output and print one JSON report at the end.
  -y, --yes                Never prompt; fail if something is missing.
  -h, --help               Show this help.
  -v, --version            Show version.

Examples:
  agentic-bun
  agentic-bun -g "add tests for the parser" -n 3 --model qwen2.5-coder:7b
  agentic-bun -t "write the docs" -t "add the benchmark" --json
  agentic-bun -g "fix lint" -n 2 -- --permission-mode acceptEdits --verbose
`;

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    goal: null,
    tasks: [],
    agents: null,
    cwd: process.cwd(),
    model: null,
    concurrency: null,
    plan: false,
    permissionMode: null,
    direct: false,
    dryRun: false,
    json: false,
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    yes: false,
    ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
    extraClaudeArgs: [],
    help: false,
    version: false,
  };

  const args = [...argv];
  const passthroughAt = args.indexOf("--");
  if (passthroughAt !== -1) {
    opts.extraClaudeArgs = args.slice(passthroughAt + 1);
    args.length = passthroughAt;
  }

  const valueOf = (arg: string, inline: string | undefined, i: { v: number }): string => {
    if (inline !== undefined) return inline;
    const next = args[++i.v];
    if (next === undefined) throw new Error(`${arg} needs a value`);
    return next;
  };

  const cursor = { v: 0 };
  for (; cursor.v < args.length; cursor.v++) {
    const raw = args[cursor.v];
    const eq = raw.indexOf("=");
    const flag = raw.startsWith("--") && eq !== -1 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith("--") && eq !== -1 ? raw.slice(eq + 1) : undefined;

    switch (flag) {
      case "-g":
      case "--goal":
        opts.goal = valueOf(flag, inline, cursor);
        break;
      case "-t":
      case "--task":
        opts.tasks.push(valueOf(flag, inline, cursor));
        break;
      case "-n":
      case "--agents":
        opts.agents = parseCount(valueOf(flag, inline, cursor), flag);
        break;
      case "-C":
      case "--cwd":
        opts.cwd = valueOf(flag, inline, cursor);
        break;
      case "-m":
      case "--model":
        opts.model = valueOf(flag, inline, cursor);
        break;
      case "-c":
      case "--concurrency":
        opts.concurrency = parseCount(valueOf(flag, inline, cursor), flag);
        break;
      case "--plan":
        opts.plan = true;
        break;
      case "--permission-mode":
        opts.permissionMode = valueOf(flag, inline, cursor);
        break;
      case "--direct":
        opts.direct = true;
        break;
      case "--ollama-host":
        opts.ollamaHost = valueOf(flag, inline, cursor);
        break;
      case "--timeout":
        opts.timeoutSec = parseCount(valueOf(flag, inline, cursor), flag);
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "-y":
      case "--yes":
        opts.yes = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      default:
        throw new Error(`unknown option: ${raw}`);
    }
  }

  if (opts.agents !== null && opts.agents > MAX_AGENTS) throw new Error(`--agents must be <= ${MAX_AGENTS}`);
  if (opts.plan && opts.tasks.length)
    throw new Error("--plan and --task are mutually exclusive: --task already says what each agent does");
  return opts;
}

function parseCount(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer, got "${value}"`);
  return n;
}

/** Fail fast with an actionable message rather than a confusing spawn error. */
function preflight(probe: OllamaProbe, opts: Options): string[] {
  const problems: string[] = [];
  const notes: string[] = [];

  if (!probe.binary) {
    if (!opts.direct) {
      problems.push(
        "`ollama` was not found on PATH. Install it from https://ollama.com, or use --direct with a reachable --ollama-host.",
      );
    }
  } else {
    if (!probe.versionOk) {
      notes.push(`ollama ${probe.version ?? "(unknown version)"} detected; ${MIN_OLLAMA_VERSION}+ is recommended.`);
    }
    if (!opts.direct && !probe.launch.supported) {
      problems.push(
        "`ollama launch` is not available on this ollama version. Upgrade ollama, or pass --direct to run `claude` against the Ollama API yourself.",
      );
    }
  }

  if (!opts.direct && probe.launch.supported) {
    if (!probe.launch.supportsModelFlag)
      notes.push("`ollama launch` does not advertise --model; the model will be chosen by ollama.");
    if (!probe.launch.supportsYesFlag)
      notes.push("`ollama launch` does not advertise --yes; it may prompt interactively.");
    if (!probe.launch.supportsPassthrough)
      notes.push("`ollama launch --help` does not document `-- <args>` passthrough; trying it anyway.");
  }

  if (opts.direct && !Bun.which("claude")) {
    problems.push("--direct needs the `claude` CLI on PATH. Install it from https://claude.com/code.");
  }

  for (const note of notes) console.error(`note: ${note}`);
  return problems;
}

interface Answers {
  goal: string;
  cwd: string;
  tasks: string[];
  agentCount: number;
  model: string | null;
}

async function runWizard(opts: Options, probe: OllamaProbe): Promise<Answers> {
  // Questions and their echo go to stderr so stdout stays clean for --json/--dry-run.
  // Lines are queued as readline emits them: piped input arrives in one burst, so a
  // question asked later still finds its answer. EOF just means "use the default".
  const rl = opts.yes
    ? null
    : createInterface({ input: process.stdin, output: process.stderr, terminal: Boolean(process.stdin.isTTY) });

  let closed = false;
  const pending: string[] = [];
  const waiting: Array<(line: string | null) => void> = [];
  rl?.on("line", line => {
    const waiter = waiting.shift();
    if (waiter) waiter(line);
    else pending.push(line);
  });
  rl?.on("close", () => {
    closed = true;
    while (waiting.length) waiting.shift()!(null);
  });
  rl?.on("SIGINT", () => {
    rl.close();
    process.exit(130);
  });

  const ask = async (question: string, fallback = ""): Promise<string> => {
    if (!rl) return fallback;
    let line: string | null;
    if (pending.length) {
      process.stderr.write(`${question}\n`);
      line = pending.shift()!;
    } else if (closed) {
      line = null;
    } else {
      process.stderr.write(question);
      line = await new Promise<string | null>(resolve => waiting.push(resolve));
    }
    const trimmed = (line ?? "").trim();
    return trimmed.length ? trimmed : fallback;
  };

  try {
    // 1. goal
    let goal = opts.goal ?? "";
    if (!goal && opts.tasks.length) goal = opts.tasks.join("; ");
    const askedGoal = !goal;
    if (!goal) {
      goal = await ask("What do you want done? ");
      if (!goal) throw new Error("a goal is required (pass --goal, or answer the first question)");
    }

    // 2. working directory. Only worth asking someone who is already answering
    // questions - anyone passing --goal/--task on the command line can pass --cwd too.
    const cwd =
      askedGoal && opts.cwd === process.cwd()
        ? await ask(`Which directory should the agents work in? [${process.cwd()}] `, process.cwd())
        : opts.cwd;

    // 3. how many agents
    let agentCount = opts.agents ?? opts.tasks.length;
    if (!agentCount) {
      const answer = await ask("How many agents should run in parallel? [1] ", "1");
      agentCount = parseCount(answer, "agent count");
      if (agentCount > MAX_AGENTS) throw new Error(`at most ${MAX_AGENTS} agents`);
    }

    // 4. per-agent tasks (only worth asking when there is more than one agent)
    let tasks = [...opts.tasks];
    if (!tasks.length && agentCount > 1 && !opts.plan && rl && !closed) {
      console.error(
        "Describe each agent's task, one per line. Press Enter on an empty line to let the model split the goal for you.",
      );
      for (let i = 0; i < agentCount; i++) {
        const task = await ask(`  agent ${i + 1}: `);
        if (!task) break;
        tasks.push(task);
      }
    }
    if (tasks.length && tasks.length !== agentCount) agentCount = tasks.length;
    if (!tasks.length && agentCount === 1) tasks = [goal];

    // 5. model
    let model = opts.model;
    if (!model) {
      if (probe.models.length === 1) {
        model = probe.models[0];
        console.error(`note: using the only installed model, ${model}.`);
      } else if (probe.models.length > 1 && rl && !closed) {
        console.error("Installed models:");
        probe.models.forEach((m, i) => console.error(`  ${i + 1}. ${m}`));
        const answer = await ask(`Which model? [1] `, "1");
        const index = Number(answer);
        model =
          Number.isInteger(index) && index >= 1 && index <= probe.models.length ? probe.models[index - 1] : answer;
      } else if (probe.models.length > 1) {
        model = probe.models[0];
        console.error(`note: defaulting to ${model}; pass --model to choose another.`);
      }
    }

    return { goal, cwd, tasks, agentCount, model };
  } finally {
    rl?.close();
  }
}

function runnerOptions(
  opts: Options,
  probe: OllamaProbe,
  model: string | null,
  cwd: string,
  agentCount: number,
  capture: boolean,
): RunnerOptions {
  const useLaunch = !opts.direct && probe.launch.supported;
  return {
    ollamaBinary: probe.binary ?? "ollama",
    claudeBinary: Bun.which("claude") ?? "claude",
    useLaunch,
    supportsModelFlag: probe.launch.supportsModelFlag,
    supportsYesFlag: probe.launch.supportsYesFlag,
    model,
    cwd,
    permissionMode: opts.permissionMode ?? undefined,
    extraClaudeArgs: opts.extraClaudeArgs,
    concurrency: opts.concurrency ?? Math.min(agentCount, DEFAULT_MAX_CONCURRENCY),
    timeoutMs: opts.timeoutSec * 1000,
    ollamaHost: opts.ollamaHost,
    capture,
    color: !capture && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  };
}

/** One throwaway headless call that asks the model to split the goal. */
async function planTasks(goal: string, count: number, cwd: string, runner: RunnerOptions): Promise<string[]> {
  console.error(`Splitting the goal into ${count} tasks...`);
  const job: Job = { id: "plan", task: "decompose the goal", prompt: buildPlannerPrompt(goal, count, cwd) };
  const [result] = await runAgents([job], { ...runner, capture: true, concurrency: 1 });
  const raw = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  const tasks = extractTaskList(raw).slice(0, count);
  if (!tasks.length) {
    const preview = raw.trim().slice(0, 500) || "(no output)";
    throw new Error(
      `could not read a task list from the model. It replied:\n${preview}\n\nPass --task explicitly instead.`,
    );
  }
  if (tasks.length < count) console.error(`note: the model returned ${tasks.length} task(s) instead of ${count}.`);
  return tasks;
}

function printSummary(results: AgentResult[]): number {
  const failed = results.filter(r => r.exitCode !== 0);
  console.error("");
  console.error("Summary");
  for (const r of results) {
    const status = r.timedOut
      ? "timeout"
      : r.exitCode === 0
        ? "ok"
        : `exit ${r.exitCode ?? "?"}${r.signal ? ` (${r.signal})` : ""}`;
    const seconds = (r.durationMs / 1000).toFixed(1);
    console.error(`  ${r.id.padEnd(4)} ${status.padEnd(10)} ${seconds.padStart(7)}s  ${truncate(r.task, 60)}`);
  }
  console.error(`  ${results.length - failed.length}/${results.length} agents succeeded.`);
  return failed.length ? 1 : 0;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export async function main(argv: string[]): Promise<number> {
  let opts: Options;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    console.error("run `agentic-bun --help` for usage.");
    return 2;
  }

  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (opts.version) {
    console.log(VERSION);
    return 0;
  }

  const probe = await probeOllama();
  const problems = preflight(probe, opts);
  if (problems.length) {
    for (const problem of problems) console.error(`error: ${problem}`);
    return 1;
  }

  let answers: Answers;
  try {
    answers = await runWizard(opts, probe);
    answers.cwd = resolve(answers.cwd);
    if (!statSync(answers.cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${answers.cwd} is not a directory`);
    }
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 1;
  }

  if (!answers.model && !process.env.ANTHROPIC_MODEL) {
    console.error("error: no model selected and none installed. Run `ollama pull <model>`, or pass --model.");
    return 1;
  }

  let specs: AgentSpec[];
  const planningRunner = runnerOptions(opts, probe, answers.model, answers.cwd, 1, true);
  if (answers.tasks.length) {
    specs = toSpecs(answers.tasks);
  } else if (opts.dryRun) {
    // Nothing to plan against without calling the model; show the goal as one task.
    specs = toSpecs([answers.goal]);
    console.error(`note: --dry-run skips the planning call; showing 1 agent instead of ${answers.agentCount}.`);
  } else {
    try {
      specs = toSpecs(await planTasks(answers.goal, answers.agentCount, answers.cwd, planningRunner));
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      return 1;
    }
  }

  const jobs: Job[] = specs.map((spec, index) => ({
    id: spec.id,
    task: spec.task,
    prompt: buildAgentPrompt({ goal: answers.goal, cwd: answers.cwd, spec, index, all: specs }),
  }));

  const runner = runnerOptions(opts, probe, answers.model, answers.cwd, jobs.length, opts.json);

  if (opts.dryRun) {
    for (const job of jobs) {
      console.log(`# ${job.id}: ${truncate(job.task, 70)}`);
      console.log(buildCommand(job.prompt, runner).map(quote).join(" "));
      console.log("");
    }
    return 0;
  }

  console.error(
    `Running ${jobs.length} agent(s) in ${answers.cwd}${answers.model ? ` on ${answers.model}` : ""} (concurrency ${runner.concurrency}).`,
  );
  const results = await runAgents(jobs, runner);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          goal: answers.goal,
          cwd: answers.cwd,
          model: answers.model,
          agents: results,
          ok: results.every(r => r.exitCode === 0),
        },
        null,
        2,
      ),
    );
    return results.every(r => r.exitCode === 0) ? 0 : 1;
  }

  return printSummary(results);
}

function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
