/**
 * Spawns one `claude` process per agent and supervises the pool.
 *
 * This is the whole "framework": there is no agent loop here. Each agent is a
 * real Claude Code process launched through `ollama launch claude`, so file
 * edits, shell access and web fetch come from that harness, not from us. All we
 * own is fan-out, concurrency, output multiplexing and the final report.
 */

export interface Job {
  id: string;
  task: string;
  prompt: string;
}

export interface RunnerOptions {
  ollamaBinary: string;
  claudeBinary: string;
  /** false => bypass `ollama launch` and run `claude` against OLLAMA_HOST directly. */
  useLaunch: boolean;
  supportsModelFlag: boolean;
  supportsYesFlag: boolean;
  model: string | null;
  cwd: string;
  permissionMode?: string;
  /** Forwarded verbatim to `claude` (everything after `--` on our own CLI). */
  extraClaudeArgs: string[];
  concurrency: number;
  timeoutMs: number;
  ollamaHost: string;
  /** Capture output instead of streaming it live (used by --json). */
  capture: boolean;
  color: boolean;
}

export interface AgentResult {
  id: string;
  task: string;
  command: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  startedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
}

const COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[31m"];
const RESET = "\x1b[0m";

export function buildCommand(prompt: string, opts: RunnerOptions): string[] {
  const claudeArgs = ["-p", prompt];
  if (!opts.useLaunch && opts.model) claudeArgs.push("--model", opts.model);
  if (opts.permissionMode) claudeArgs.push("--permission-mode", opts.permissionMode);
  claudeArgs.push(...opts.extraClaudeArgs);

  if (!opts.useLaunch) return [opts.claudeBinary, ...claudeArgs];

  const cmd = [opts.ollamaBinary, "launch", "claude"];
  if (opts.model && opts.supportsModelFlag) cmd.push("--model", opts.model);
  if (opts.supportsYesFlag) cmd.push("--yes");
  cmd.push("--", ...claudeArgs);
  return cmd;
}

/** Env for direct mode: the same variables `ollama launch claude` sets for us. */
export function buildEnv(opts: RunnerOptions): Record<string, string | undefined> {
  if (opts.useLaunch) return { ...process.env };
  return {
    ...process.env,
    ANTHROPIC_BASE_URL: opts.ollamaHost,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? "ollama",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "ollama",
  };
}

/** Reads a stream, splitting on newlines so multiplexed output stays line-aligned. */
async function pump(
  stream: ReadableStream<Uint8Array> | undefined,
  onLine: (line: string) => void,
  sink: string[],
): Promise<void> {
  if (!stream) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    sink.push(text);
    buffer += text;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      onLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.length) onLine(buffer);
}

async function runOne(job: Job, index: number, opts: RunnerOptions, live: Set<Bun.Subprocess>): Promise<AgentResult> {
  const command = buildCommand(job.prompt, opts);
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const color = opts.color ? COLORS[index % COLORS.length] : "";
  const reset = opts.color ? RESET : "";
  const prefix = `${color}[${job.id}]${reset} `;
  const write = (line: string) => process.stdout.write(`${prefix}${line}\n`);
  const writeErr = (line: string) => process.stderr.write(`${prefix}${line}\n`);
  const onOut = opts.capture ? () => {} : write;
  const onErr = opts.capture ? () => {} : writeErr;

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn({
      cmd: command,
      cwd: opts.cwd,
      env: buildEnv(opts),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: opts.timeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (err) {
    return {
      id: job.id,
      task: job.task,
      command,
      exitCode: null,
      signal: null,
      timedOut: false,
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      stdout: "",
      stderr: `failed to spawn: ${err}`,
    };
  }

  live.add(proc);
  await Promise.all([
    pump(proc.stdout as ReadableStream<Uint8Array>, onOut, stdoutChunks),
    pump(proc.stderr as ReadableStream<Uint8Array>, onErr, stderrChunks),
  ]);
  const exitCode = await proc.exited;
  live.delete(proc);

  const signal = proc.signalCode ?? null;
  return {
    id: job.id,
    task: job.task,
    command,
    exitCode,
    signal,
    // Bun kills on timeout with killSignal; a SIGKILL we did not send is the tell.
    timedOut: signal === "SIGKILL" && Math.round(performance.now() - t0) >= opts.timeoutMs,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  };
}

/** Runs every job, at most `concurrency` at a time. Results keep the input order. */
export async function runAgents(jobs: Job[], opts: RunnerOptions): Promise<AgentResult[]> {
  const results = new Array<AgentResult>(jobs.length);
  const live = new Set<Bun.Subprocess>();
  let next = 0;
  let interrupted = false;

  const onSignal = () => {
    interrupted = true;
    process.stderr.write("\nInterrupted - stopping agents...\n");
    for (const proc of live) proc.kill("SIGTERM");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const workers = Array.from({ length: Math.min(Math.max(1, opts.concurrency), jobs.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= jobs.length || interrupted) return;
        results[i] = await runOne(jobs[i], i, opts, live);
      }
    });
    await Promise.all(workers);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  return results.filter(Boolean);
}
