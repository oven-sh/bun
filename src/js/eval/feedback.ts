import { spawnSync } from "node:child_process";
import { closeSync, promises as fsp, openSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import tty from "node:tty";
import { parseArgs as nodeParseArgs } from "node:util";

const supportsAnsi = Boolean(process.stdout.isTTY && !("NO_COLOR" in process.env));
const reset = supportsAnsi ? "\x1b[0m" : "";
const bold = supportsAnsi ? "\x1b[1m" : "";
const dim = supportsAnsi ? "\x1b[2m" : "";
const red = supportsAnsi ? "\x1b[31m" : "";
const green = supportsAnsi ? "\x1b[32m" : "";
const cyan = supportsAnsi ? "\x1b[36m" : "";
const gray = supportsAnsi ? "\x1b[90m" : "";
const symbols = {
  question: `${cyan}?${reset}`,
  check: `${green}✔${reset}`,
  cross: `${red}✖${reset}`,
};
const inputPrefix = `${gray}> ${reset}`;
const thankYouBanner = `
${supportsAnsi ? bold : ""}THANK YOU! ${reset}`;
const enum IPSupport {
  ipv4 = "ipv4",
  ipv6 = "ipv6",
  ipv4_and_ipv6 = "ipv4_and_ipv6",
  none = "none",
}

type TerminalIO = {
  input: tty.ReadStream;
  output: tty.WriteStream;
  cleanup: () => void;
};

function openTerminal(): TerminalIO | null {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return {
      input: process.stdin as unknown as tty.ReadStream,
      output: process.stdout as unknown as tty.WriteStream,
      cleanup: () => {},
    };
  }

  const candidates = process.platform === "win32" ? ["CON"] : ["/dev/tty"];

  for (const candidate of candidates) {
    try {
      const fd = openSync(candidate, "r+");
      const input = new tty.ReadStream(fd);
      const output = new tty.WriteStream(fd);
      input.setEncoding("utf8");
      return {
        input,
        output,
        cleanup: () => {
          input.destroy();
          output.destroy();
          try {
            closeSync(fd);
          } catch {}
        },
      };
    } catch {}
  }

  return null;
}
const logError = (message: string) => {
  process.stderr.write(`${symbols.cross} ${message}\n`);
};

const isValidEmail = (value: string | undefined): value is string => {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed.includes("@")) return false;
  if (!trimmed.includes(".")) return false;
  return true;
};

type ParsedArgs = {
  email?: string;
  help: boolean;
  positionals: string[];
};

function parseCliArgs(argv: string[]): ParsedArgs {
  try {
    const { values, positionals } = nodeParseArgs({
      args: argv,
      allowPositionals: true,
      strict: false,
      options: {
        email: {
          type: "string",
          short: "e",
        },
        help: {
          type: "boolean",
          short: "h",
        },
      },
    });

    return {
      email: values.email,
      help: Boolean(values.help),
      positionals,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    process.exit(1);
    return { email: undefined, help: false, positionals: [] };
  }
}

function printHelp() {
  const heading = `${bold}${cyan}bun feedback${reset}`;
  const usage = `${bold}Usage${reset}
  bun feedback [options] [feedback text ... | files ...]`;
  const options = `${bold}Options${reset}
  ${cyan}-e${reset}, ${cyan}--email${reset} <email>   Set the email address used for this submission
  ${cyan}-h${reset}, ${cyan}--help${reset}            Show this help message and exit`;
  const examples = `${bold}Examples${reset}
  bun feedback "Love the new release!"
  bun feedback report.txt details.log
  echo "please document X" | bun feedback --email you@example.com`;

  console.log([heading, "", usage, "", options, "", examples].join("\n"));
}

async function readEmailFromBunInstall(): Promise<string | undefined> {
  const installRoot = process.env.BUN_INSTALL ?? path.join(os.homedir(), ".bun");
  const emailFile = path.join(installRoot, "feedback");
  try {
    const data = await fsp.readFile(emailFile, "utf8");
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Unable to read ${emailFile}:`, (error as Error).message);
    }
    return undefined;
  }
}

async function persistEmailToBunInstall(email: string): Promise<void> {
  const installRoot = process.env.BUN_INSTALL;
  if (!installRoot) return;

  const emailFile = path.join(installRoot, "feedback");
  try {
    await fsp.mkdir(path.dirname(emailFile), { recursive: true });
    await fsp.writeFile(emailFile, `${email.trim()}\n`, "utf8");
  } catch (error) {
    console.warn(`Unable to persist email to ${emailFile}:`, (error as Error).message);
  }
}

function readEmailFromGitConfig(): string | undefined {
  const result = spawnSync("git", ["config", "user.email"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return undefined;
  }
  const output = result.stdout.trim();
  return output.length > 0 ? output : undefined;
}

async function promptForEmail(terminal: TerminalIO | null, defaultEmail?: string): Promise<string | undefined> {
  if (!terminal) {
    return defaultEmail && isValidEmail(defaultEmail) ? defaultEmail : undefined;
  }

  let currentDefault = defaultEmail;

  for (;;) {
    const answer = await promptForEmailInteractive(terminal, currentDefault);
    if (typeof answer === "string" && isValidEmail(answer)) {
      return answer.trim();
    }

    terminal.output.write(`${symbols.cross} Please provide a valid email address containing "@" and ".".\n`);
    currentDefault = undefined;
  }
}

async function promptForEmailInteractive(terminal: TerminalIO, defaultEmail?: string): Promise<string | undefined> {
  const input = terminal.input;
  const output = terminal.output;

  readline.emitKeypressEvents(input);
  const hadRawMode = typeof input.isRaw === "boolean" ? input.isRaw : undefined;
  if (typeof input.setRawMode === "function") {
    input.setRawMode(true);
  }
  if (typeof input.resume === "function") {
    input.resume();
  }

  const placeholder = defaultEmail ?? "";
  let placeholderActive = placeholder.length > 0;
  let value = "";
  let resolved = false;

  const render = () => {
    output.write(`\r\x1b[2K${symbols.question} ${bold}Email${reset}: `);
    if (placeholderActive && placeholder.length > 0) {
      output.write(`${dim}<${placeholder}>${reset}`);
      output.write(`\x1b[${placeholder.length + 2}D`);
    } else {
      output.write(value);
    }
  };

  render();

  return await new Promise<string | undefined>(resolve => {
    const cleanup = (result?: string) => {
      if (resolved) return;
      resolved = true;
      input.removeListener("keypress", onKeypress);
      if (typeof input.setRawMode === "function") {
        if (typeof hadRawMode === "boolean") {
          input.setRawMode(hadRawMode);
        } else {
          input.setRawMode(false);
        }
      }
      if (typeof input.pause === "function") {
        input.pause();
      }
      output.write("\n");
      resolve(result);
    };

    const onKeypress = (str: string, key: readline.Key) => {
      if (!key && str) {
        if (placeholderActive) {
          placeholderActive = false;
          value = "";
          render();
        }
        value += str;
        output.write(str);
        return;
      }

      if (key && (key.sequence === "\u0003" || (key.ctrl && key.name === "c"))) {
        cleanup();
        process.exit(130);
        return;
      }

      if (key?.name === "return") {
        if (placeholderActive && placeholder.length > 0) {
          cleanup(placeholder);
          return;
        }
        const trimmed = value.trim();
        cleanup(trimmed.length > 0 ? trimmed : undefined);
        return;
      }

      if (key?.name === "backspace") {
        if (placeholderActive) {
          return;
        }
        if (value.length > 0) {
          value = value.slice(0, -1);
          render();
        }
        return;
      }

      if (!str) {
        return;
      }

      if (key && key.name && key.name.length > 1 && key.name !== "space") {
        return;
      }

      if (placeholderActive) {
        placeholderActive = false;
        value = "";
        render();
      }

      value += str;
      output.write(str);
    };

    input.on("keypress", onKeypress);
  });
}

async function promptForBody(
  terminal: TerminalIO | null,
  attachments: PositionalContent["files"],
): Promise<string | undefined> {
  if (!terminal) {
    return undefined;
  }

  const input = terminal.input;
  const output = terminal.output;

  readline.emitKeypressEvents(input);
  const hadRawMode = typeof input.isRaw === "boolean" ? input.isRaw : undefined;
  if (typeof input.setRawMode === "function") {
    input.setRawMode(true);
  }
  if (typeof input.resume === "function") {
    input.resume();
  }

  const header = `${symbols.question} ${bold}Share your feedback with Bun's team${reset} ${dim}(Enter to send, Shift+Enter for a newline)${reset}`;
  output.write(`${header}\n`);
  if (attachments.length > 0) {
    output.write(`${dim}+ ${attachments.map(file => file.filename).join(", ")}${reset}\n`);
  }
  output.write(`${inputPrefix}`);

  const lines: string[] = [""];
  let currentLine = 0;
  let resolved = false;

  return await new Promise<string | undefined>(resolve => {
    const cleanup = (value?: string) => {
      if (resolved) return;
      resolved = true;
      input.removeListener("keypress", onKeypress);
      if (typeof input.setRawMode === "function") {
        if (typeof hadRawMode === "boolean") {
          input.setRawMode(hadRawMode);
        } else {
          input.setRawMode(false);
        }
      }
      if (typeof input.pause === "function") {
        input.pause();
      }
      output.write("\n");
      resolve(value);
    };

    const onKeypress = (str: string, key: readline.Key) => {
      if (!key) {
        if (str) {
          lines[currentLine] += str;
          output.write(str);
        }
        return;
      }

      if (key.sequence === "\u0003" || (key.ctrl && key.name === "c")) {
        cleanup();
        process.exit(130);
        return;
      }

      if (key.name === "return") {
        if (key.shift) {
          lines.push("");
          currentLine += 1;
          output.write(`\n${inputPrefix}`);
          return;
        }
        const message = lines.join("\n");
        cleanup(message);
        return;
      }

      if (key.name === "backspace") {
        const current = lines[currentLine];
        if (current.length > 0) {
          lines[currentLine] = current.slice(0, -1);
          output.write("\b \b");
        } else if (currentLine > 0) {
          lines.pop();
          currentLine -= 1;
          output.write("\r\x1b[2K");
          output.write("\x1b[F");
          output.write("\r\x1b[2K");
          output.write(`${inputPrefix}${lines[currentLine]}`);
        }
        return;
      }

      if (key.name && key.name.length > 1 && key.name !== "space") {
        return;
      }

      if (str) {
        lines[currentLine] += str;
        output.write(str);
      }
    };

    input.on("keypress", onKeypress);
  });
}

async function readFromStdin(): Promise<string | undefined> {
  const stdin = process.stdin;
  if (!stdin || stdin.isTTY) return undefined;

  if (typeof stdin.setEncoding === "function") {
    stdin.setEncoding("utf8");
  }

  if (typeof stdin.resume === "function") {
    stdin.resume();
  }

  const chunks: string[] = [];
  for await (const chunk of stdin as AsyncIterable<string | Buffer>) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }

  const content = chunks.join("");
  return content.length > 0 ? content : undefined;
}

type PositionalContent = {
  messageParts: string[];
  files: { filename: string; content: Uint8Array<ArrayBuffer> }[];
};

async function resolveFileCandidate(token: string): Promise<string | undefined> {
  const candidates = new Set<string>();
  candidates.add(token);

  if (token.startsWith("~/")) {
    candidates.add(path.join(os.homedir(), token.slice(2)));
  }

  const resolved = path.join(process.cwd(), token);
  candidates.add(resolved);

  for (const candidate of candidates) {
    try {
      const stat = await fsp.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && (code === "ENOENT" || code === "ENOTDIR")) {
        continue;
      }
      console.warn(`Unable to inspect ${candidate}:`, (error as Error).message);
    }
  }

  return undefined;
}

async function readFromPositionals(positionals: string[]): Promise<PositionalContent> {
  const messageParts: string[] = [];
  const files: PositionalContent["files"] = [];
  let literalTokens: string[] = [];

  const flushTokens = () => {
    if (literalTokens.length > 0) {
      messageParts.push(literalTokens.join(" "));
      literalTokens = [];
    }
  };

  for (const token of positionals) {
    const filePath = await resolveFileCandidate(token);

    if (filePath) {
      try {
        let fileContents = await Bun.file(filePath).bytes();
        // Truncate to
        if (fileContents.length > 1024 * 1024 * 10) {
          fileContents = fileContents.slice(0, 1024 * 1024 * 10);
        }

        flushTokens();
        files.push({
          filename: path.normalize(path.relative(process.cwd(), filePath)),
          content: fileContents,
        });
        continue;
      } catch {
        // Ignore read errors; treat token as part of the message instead.
      }
    }

    literalTokens.push(token);
  }

  flushTokens();
  return { messageParts, files };
}

function getIPSupport(networkInterface: os.NetworkInterfaceInfo, original: IPSupport): IPSupport {
  if (networkInterface.family === "IPv4") {
    switch (original) {
      case IPSupport.none:
        return IPSupport.ipv4;
      case IPSupport.ipv4:
        return IPSupport.ipv4_and_ipv6;
      case IPSupport.ipv6:
        return IPSupport.ipv4_and_ipv6;
      case IPSupport.ipv4_and_ipv6:
        return IPSupport.ipv4_and_ipv6;
    }
  } else if (networkInterface.family === "IPv6") {
    switch (original) {
      case IPSupport.none:
        return IPSupport.ipv6;
      case IPSupport.ipv4:
        return IPSupport.ipv4_and_ipv6;
      case IPSupport.ipv6:
        return IPSupport.ipv4_and_ipv6;
      case IPSupport.ipv4_and_ipv6:
        return IPSupport.ipv4_and_ipv6;
    }
  }
  return original;
}

function getOldestGitSha(): string | undefined {
  const result = spawnSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return undefined;
  }

  const firstLine = result.stdout.split(/\r?\n/).find(line => line.trim().length > 0);
  return firstLine?.trim();
}

async function main() {
  const rawArgv = process.argv.slice(1);

  let terminal: TerminalIO | null = null;
  try {
    const { email: emailFlag, help, positionals } = parseCliArgs(rawArgv);
    if (help) {
      printHelp();
      return;
    }

    terminal = openTerminal();

    const exit = (code: number): never => {
      terminal?.cleanup();
      process.exit(code);
    };

    if (emailFlag && !isValidEmail(emailFlag)) {
      logError("The provided email must include both '@' and '.'.");
      exit(1);
    }

    const storedEmailRaw = await readEmailFromBunInstall();
    const storedEmail = isValidEmail(storedEmailRaw) ? storedEmailRaw.trim() : undefined;

    const gitEmailRaw = readEmailFromGitConfig();
    const gitEmail = isValidEmail(gitEmailRaw) ? gitEmailRaw.trim() : undefined;

    const canPrompt = terminal !== null;

    let email = emailFlag?.trim() ?? storedEmail ?? gitEmail;

    if (canPrompt && !emailFlag && !storedEmail) {
      email = await promptForEmail(terminal, email ?? gitEmail ?? undefined);
    }

    if (!isValidEmail(email)) {
      if (!canPrompt) {
        logError("Unable to determine email automatically. Pass --email <address>.");
      } else {
        logError("An email address is required. Pass --email or configure git user.email.");
      }
      exit(1);
      return;
    }

    const normalizedEmail = email.trim();

    if (process.env.BUN_INSTALL && !storedEmail) {
      await persistEmailToBunInstall(normalizedEmail);
    }

    const stdinContent = await readFromStdin();
    const positionalContent = await readFromPositionals(positionals);
    const positionalParts = positionalContent.messageParts;
    const pieces: string[] = [];
    if (stdinContent && stdinContent.trim().length > 0) pieces.push(stdinContent);
    for (const part of positionalParts) {
      if (part.trim().length > 0) {
        pieces.push(part);
      }
    }

    let message = pieces.length > 0 ? pieces.join(pieces.length > 1 ? "\n\n" : "") : "";

    if (message.trim().length === 0 && terminal) {
      const interactiveBody = await promptForBody(terminal, positionalContent.files);
      if (interactiveBody && interactiveBody.trim().length > 0) {
        message = interactiveBody;
      }
    }

    const normalizedMessage = message.trim();
    if (normalizedMessage.length === 0) {
      logError("No feedback provided. Supply text, file paths, or pipe input.");
      exit(1);
      return;
    }

    const messageBody = normalizedMessage;

    const projectId = getOldestGitSha();
    const endpoint = process.env.BUN_FEEDBACK_URL || "https://bun.report/v1/feedback";

    const form = new FormData();
    form.append("email", normalizedEmail);
    form.append("message", messageBody);
    for (const file of positionalContent.files) {
      form.append("files[]", new Blob([file.content]), file.filename);
    }

    const id = Bun.randomUUIDv7();

    form.append("platform", process.platform);
    form.append("arch", process.arch);
    form.append("bunRevision", Bun.revision);
    form.append("hardwareConcurrency", String(navigator.hardwareConcurrency));
    form.append("bunVersion", Bun.version);
    form.append("bunBuild", path.basename(process.release.sourceUrl!, path.extname(process.release.sourceUrl!)));
    form.append("availableMemory", String(process.availableMemory()));
    form.append("totalMemory", String(os.totalmem()));
    form.append("osVersion", String(os.version()));
    form.append("osRelease", String(os.release()));
    form.append("id", id);

    // Check if we're running in Docker
    let inDocker = false;
    if (process.platform === "linux") {
      if (require("fs").existsSync("/.dockerenv")) {
        inDocker = true;
      }
    }

    if (inDocker) {
      form.append("docker", "true");
    }

    let remoteIP: IPSupport = IPSupport.none;
    let localIP: IPSupport = IPSupport.none;

    try {
      const networkInterfaces = Object.entries(os.networkInterfaces() || {});

      for (const [_name, interfaces] of networkInterfaces) {
        for (const networkInterface of interfaces || []) {
          if (networkInterface.family === "IPv4") {
            if (networkInterface.internal) {
              localIP = getIPSupport(networkInterface, localIP);
            } else {
              remoteIP = getIPSupport(networkInterface, remoteIP);
            }
          } else if (networkInterface.family === "IPv6") {
            if (networkInterface.internal) {
              localIP = getIPSupport(networkInterface, localIP);
            } else {
              remoteIP = getIPSupport(networkInterface, remoteIP);
            }
          }
        }
      }
    } catch {
      // Ignore errors; treat as no IP support.
    }

    form.append("localIPSupport", localIP);
    form.append("remoteIPSupport", remoteIP);

    // Check if current working directory is on a remote filesystem
    if (process.platform === "linux" || process.platform === "darwin") {
      let isRemoteFilesystem = false;
      try {
        const cwd = process.cwd();
        const stats = await fsp.statfs(cwd);

        // Check filesystem type based on the type field
        // Common remote filesystem types have specific type values
        const remoteFsTypes = new Set([
          0x6969, // NFS
          0xff534d42, // CIFS/SMB
          0x65735546, // FUSE (used by sshfs, etc.)
        ]);

        if (remoteFsTypes.has(stats.type)) {
          isRemoteFilesystem = true;
        }
      } catch {
        // Ignore errors; treat as local filesystem
      }

      if (isRemoteFilesystem) {
        form.append("remoteFilesystem", "true");
      }
    }

    if (projectId) {
      form.append("projectId", projectId);
    }

    const response = await fetch(endpoint, {
      method: "POST",
      body: form,
    });

    if (!response.ok || response.status !== 200) {
      const bodyText = await response.text().catch(() => "");
      logError(`Failed to send feedback (${response.status} ${response.statusText}).`);
      if (bodyText) {
        process.stderr.write(`${bodyText}\n`);
      }
      exit(1);
    }

    let IDBanner = ``;
    if (supportsAnsi) {
      IDBanner = `\n${dim}ID: ${id}${reset}`;
    } else {
      IDBanner = `\nID: ${id}`;
    }

    process.stdout.write(`${symbols.check} Feedback sent.\n${IDBanner}${thankYouBanner}\n`);
  } finally {
    terminal?.cleanup();
  }
}

await main().catch(error => {
  const detail = error instanceof Error ? error.message : String(error);
  logError(`Unexpected error while sending feedback: ${detail}`);
  process.exit(1);
});
