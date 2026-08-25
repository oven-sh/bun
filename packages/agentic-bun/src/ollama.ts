/**
 * Everything this tool knows about the local Ollama install.
 *
 * Ollama's CLI surface changes between releases, so nothing here is hard-coded:
 * we shell out to `ollama --version`, `ollama launch --help` and `ollama list`
 * once at startup and adapt the command we build to whatever is actually
 * supported. See README.md for which flags were (and were not) verified.
 */

/** `ollama launch` landed in 0.15, but 0.14 is the floor for the Anthropic-compatible API. */
export const MIN_OLLAMA_VERSION = "0.14.0";

export interface LaunchCapabilities {
  /** False when `ollama launch` is missing entirely (too old, or renamed). */
  supported: boolean;
  supportsModelFlag: boolean;
  supportsYesFlag: boolean;
  /** Whether `-- <args>` is forwarded to the underlying `claude` invocation. */
  supportsPassthrough: boolean;
  helpText: string;
}

export interface OllamaProbe {
  binary: string | null;
  version: string | null;
  /** version >= MIN_OLLAMA_VERSION. Null version (unparseable) counts as not-ok. */
  versionOk: boolean;
  launch: LaunchCapabilities;
  models: string[];
}

export interface CaptureResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Combined stdout+stderr; CLIs disagree about where help goes. */
  output: string;
}

/** Run a command to completion and capture its output. Never throws for a non-zero exit. */
export async function capture(cmd: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<CaptureResult> {
  try {
    const proc = Bun.spawn({
      cmd,
      cwd: opts.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: opts.timeout ?? 15_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr, output: stdout + stderr };
  } catch (err) {
    return { exitCode: null, stdout: "", stderr: String(err), output: String(err) };
  }
}

export function parseVersion(text: string): string | null {
  return text.match(/\b(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

/** -1 / 0 / 1, comparing dotted numeric versions. Non-numeric suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(n => parseInt(n, 10) || 0);
  const pb = b.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** First column of `ollama list`, minus the header row. */
export function parseModels(listOutput: string): string[] {
  const models: string[] = [];
  for (const line of listOutput.split("\n")) {
    const name = line.trim().split(/\s+/)[0];
    if (!name || name === "NAME" || name.startsWith("failed") || name.startsWith("Error")) continue;
    models.push(name);
  }
  return models;
}

export function parseLaunchHelp(result: CaptureResult): LaunchCapabilities {
  const help = result.output;
  const unknown = /unknown command|unknown flag|is not a bun|command not found/i.test(help);
  const supported = !unknown && (result.exitCode === 0 || /launch/i.test(help)) && help.trim().length > 0;
  return {
    supported,
    supportsModelFlag: /(^|\s)--model\b/.test(help),
    supportsYesFlag: /(^|\s)--yes\b/.test(help),
    // Either an explicit `--` entry in the flag list, or prose describing passthrough.
    supportsPassthrough: /(^|\s)--(\s|$)/m.test(help) || /pass(ed|es)?\s+(through|straight|directly)?\s*to/i.test(help),
    helpText: help,
  };
}

export async function probeOllama(binaryName = "ollama"): Promise<OllamaProbe> {
  const binary = Bun.which(binaryName);
  if (!binary) {
    return {
      binary: null,
      version: null,
      versionOk: false,
      launch: {
        supported: false,
        supportsModelFlag: false,
        supportsYesFlag: false,
        supportsPassthrough: false,
        helpText: "",
      },
      models: [],
    };
  }

  const [versionRes, launchRes, listRes] = await Promise.all([
    capture([binary, "--version"]),
    capture([binary, "launch", "--help"]),
    capture([binary, "list"]),
  ]);

  const version = parseVersion(versionRes.output);
  return {
    binary,
    version,
    versionOk: version !== null && compareVersions(version, MIN_OLLAMA_VERSION) >= 0,
    launch: parseLaunchHelp(launchRes),
    models: listRes.exitCode === 0 ? parseModels(listRes.stdout) : [],
  };
}
