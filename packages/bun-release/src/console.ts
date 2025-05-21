import { createInterface } from "readline";
import { isatty } from "tty";

export const isAction = !!process.env["GITHUB_ACTION"];

export const isDebug =
  process.env["DEBUG"] === "1" || process.env["LOG_LEVEL"] === "debug" || process.env["RUNNER_DEBUG"] === "1";

export function debug(...message: any[]): void {
  if (isAction) {
    console.debug("::debug::", ...message);
  } else if (isDebug) {
    console.debug(...message);
  }
}

export function log(...message: any[]): void {
  console.log(...message);
}

export function warn(...message: any[]): void {
  if (isAction) {
    console.warn("::warning::", ...message);
  } else {
    console.warn(...message);
  }
}

export function error(...message: any[]): void {
  if (isAction) {
    console.error("::error::", ...message);
  } else {
    console.error(...message);
  }
}

export function exit(...message: any[]): never {
  error(...message);
  process.exit(1);
}

export function isTty(): boolean {
  return isatty(process.stdout.fd);
}

export async function stdin(question: string): Promise<string> {
  if (isTty()) {
    return prompt(question) || "";
  }
  const reader = createInterface({
    input: process.stdin,
    terminal: false,
  });
  let buffer = "";
  reader.on("line", line => {
    buffer += line;
  });
  return new Promise(resolve => {
    reader.once("close", () => resolve(buffer));
  });
}

export async function confirm(message?: string): Promise<void> {
  if (!isTty()) {
    return;
  }
  const question = message ?? "Confirm?";
  switch (prompt(`${question} [y/n]`)) {
    case "y":
    case "Y":
      log();
      return;
  }
  exit();
}
