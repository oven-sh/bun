import { spawn } from "node:child_process";

export class FormatterCancelledError extends Error {
  constructor() {
    super("Formatting was cancelled");
    this.name = "FormatterCancelledError";
  }
}

interface RunBunFormatterOptions {
  runtime: string;
  bunfig?: string;
  cwd: string;
  filepath: string;
  source: string;
  rangeStart?: number;
  rangeEnd?: number;
  token?: {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): { dispose(): void };
  };
}

export interface FormatterResult {
  stdout: string;
  stderr: string;
}

export function getBunFormatterArgs(
  filepath: string,
  bunfig?: string,
  range?: { start: number; end: number },
): string[] {
  const args = ["fmt", "--no-script", "--stdin-filepath", filepath];
  if (range) args.push(`--range-start=${range.start}`, `--range-end=${range.end}`);
  if (bunfig) args.unshift(`--config=${bunfig}`);
  return args;
}

export function runBunFormatter({
  runtime,
  bunfig,
  cwd,
  filepath,
  source,
  rangeStart,
  rangeEnd,
  token,
}: RunBunFormatterOptions): Promise<FormatterResult> {
  if (token?.isCancellationRequested) {
    return Promise.reject(new FormatterCancelledError());
  }

  return new Promise((resolve, reject) => {
    const range = rangeStart !== undefined && rangeEnd !== undefined ? { start: rangeStart, end: rangeEnd } : undefined;
    const child = spawn(runtime, getBunFormatterArgs(filepath, bunfig, range), {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdinError: Error | undefined;
    let outputError: Error | undefined;
    let settled = false;
    let cancelled = false;

    const cancellation = token?.onCancellationRequested(() => {
      cancelled = true;
      child.kill();
    });

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cancellation?.dispose();
      callback();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });

    child.stdout.once("error", error => {
      outputError = error;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });

    child.stderr.once("error", error => {
      outputError = error;
    });

    child.once("error", error => {
      finish(() => reject(new Error(`Failed to start Bun formatter: ${error.message}`, { cause: error })));
    });

    child.stdin.once("error", error => {
      stdinError = error;
    });

    child.once("close", (code, signal) => {
      if (cancelled) {
        finish(() => reject(new FormatterCancelledError()));
      } else if (outputError) {
        const error = outputError;
        finish(() => reject(new Error(`Failed to read Bun formatter output: ${error.message}`)));
      } else if (code === 0) {
        finish(() => resolve({ stdout, stderr }));
      } else {
        const message =
          stderr.trim() ||
          (stdinError ? `Failed to send the document to Bun formatter: ${stdinError.message}` : undefined) ||
          (signal
            ? `Bun formatter was terminated by ${signal}`
            : `Bun formatter exited with code ${code ?? "unknown"}`);
        finish(() => reject(new Error(message)));
      }
    });

    child.stdin.end(source);
  });
}
