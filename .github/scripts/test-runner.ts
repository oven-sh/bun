// Dear reader
//
// The existence of this file is temporary, a hack.
import { join, basename } from "node:path";
import { readdirSync, writeSync, fsyncSync, appendFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

export { parseTest, runTest, formatTest };

export type ParseTestOptions = {
  cwd?: string;
  paths?: string[];
};

export type ParseTestResult = {
  info: TestInfo;
  files: TestFile[];
  summary: TestSummary;
};

export type RunTestOptions = ParseTestOptions & {
  args?: string[];
  timeout?: number;
  isolate?: boolean;
};

export type RunTestResult = ParseTestResult & {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type TestInfo = {
  name: string;
  version: string;
  revision: string;
  os: string;
  arch: string;
};

export type TestFile = {
  file: string;
  status: TestStatus;
  tests: Test[];
  summary: TestSummary;
  errors?: TestError[];
};

export type TestError = {
  name: string;
  message: string;
  stack?: TestErrorStack[];
};

export type TestErrorStack = {
  file: string;
  function?: string;
  line: number;
  column?: number;
};

export type TestStatus = "pass" | "fail" | "skip";

export type Test = {
  name: string;
  status: TestStatus;
  errors?: TestError[];
};

export type TestSummary = {
  pass: number;
  fail: number;
  skip: number;
  tests: number;
  files: number;
  duration: number;
};

function parseTest(lines: string[], options?: ParseTestOptions): ParseTestResult {
  let i = 0;
  const isDone = () => {
    return i >= lines.length;
  };
  const readLine = () => {
    return lines[i++];
  };
  function readUntil<V>(cb: (line: string) => V | undefined): V | undefined {
    while (!isDone()) {
      const line = readLine();
      const result = cb(line);
      if (result) {
        return result;
      }
    }
  }
  const { cwd, paths = cwd ? Array.from(listFiles(cwd, "")) : [] } = options ?? {};
  const info = readUntil(parseInfo);
  if (!info) {
    throw new Error("No tests found");
  }
  const files: TestFile[] = [];
  let file: TestFile | undefined;
  let test: Test | undefined;
  let error: TestError | undefined;
  let errorStart: number | undefined;
  let summary: TestSummary | undefined;
  const reset = () => {
    if (error) {
      if (file) {
        if (test) {
          if (!test?.errors) {
            test.errors = [error];
          } else {
            test.errors.push(error);
          }
        } else {
          if (!file.errors) {
            file.errors = [error];
          } else {
            file.errors.push(error);
          }
        }
      }
      error = undefined;
      errorStart = undefined;
    }
  };
  while (!isDone()) {
    const line = readLine();
    if (error) {
      const newStack = parseStack(line, cwd);
      if (newStack) {
        if (errorStart !== undefined) {
          for (let j = errorStart; j < i - 1; j++) {
            error.message += `\n${lines[j]}`;
          }
          errorStart = undefined;
        }
        if (!error.stack) {
          error.stack = [newStack];
        } else {
          error.stack.push(newStack);
        }
        continue;
      }
    }
    const newFile = parseFile(line, paths);
    if (newFile) {
      reset();
      file = newFile;
      files.push(file);
      continue;
    }
    const newTest = parseStatus(line);
    if (newTest) {
      if (newTest.status === "skip" && error) {
        continue;
      }
      test = newTest;
      if (file) {
        file.tests.push(test);
        file.summary[test.status]++;
        file.summary.tests++;
        if (test.status === "fail") {
          file.status = "fail";
        }
      }
      file?.tests.push(test);
      reset();
      continue;
    }
    const newError = parseError(line);
    if (newError) {
      reset();
      error = newError;
      errorStart = i;
      continue;
    }
    const newSkip = parseSkip(line);
    if (newSkip) {
      reset();
      i += parseSkip(line);
      continue;
    }
    const newSummary = parseSummary(line);
    if (newSummary) {
      summary = newSummary;
      break;
    }
  }
  summary = {
    tests: files.reduce((n, file) => n + file.tests.length, 0),
    files: files.length,
    duration: 0,
    ...summary,
    pass: files.reduce((n, file) => n + file.tests.filter(test => test.status === "pass").length, 0),
    fail: files.reduce((n, file) => n + file.tests.filter(test => test.status === "fail").length, 0),
    skip: files.reduce((n, file) => n + file.tests.filter(test => test.status === "skip").length, 0),
  };
  if (files.length === 1) {
    files[0].summary = summary;
  }
  return {
    info,
    files,
    summary,
  };
}

function getRevision(): string {
  if ("Bun" in globalThis) {
    return Bun.revision;
  }
  const { stdout } = spawnSync("bun", ["get-revision.js"], {
    cwd: new URL(".", import.meta.url),
    stdio: "pipe",
    encoding: "utf-8",
  });
  return stdout.trim();
}

function parseInfo(line: string): TestInfo | undefined {
  const match = /^(bun (?:wip)?test) v([0-9\.]+) \(([0-9a-z]+)\)$/.exec(line);
  if (!match) {
    return undefined;
  }
  const [, name, version, sha] = match;
  return {
    name,
    version,
    revision: getRevision(),
    os: process.platform,
    arch: process.arch,
  };
}

function parseFile(line: string, paths?: string[]): TestFile | undefined {
  const match = /^([a-z0-9_-]+\.(?:test|spec)\.(?:c|m)?(?:j|t)sx?)\:$/.exec(line);
  if (!match) {
    return undefined;
  }
  let [, file] = match;
  for (const path of paths ?? []) {
    if (path.endsWith(file)) {
      file = path;
      break;
    }
  }
  return {
    file,
    tests: [],
    status: "pass",
    summary: {
      files: 1,
      tests: 0,
      pass: 0,
      fail: 0,
      skip: 0,
      duration: 0,
    },
  };
}

function parseStatus(line: string): Test | undefined {
  const match = /^(✓|✗|-) (.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  const [, icon, name] = match;
  return {
    name,
    status: icon === "✓" ? "pass" : icon === "✗" ? "fail" : "skip",
  };
}

function parseError(line: string): TestError | undefined {
  const match = /^(.*error)\: (.*)$/i.exec(line);
  if (!match) {
    return undefined;
  }
  const [, name, message] = match;
  return {
    name: name === "error" ? "Error" : name,
    message,
  };
}

function parseStack(line: string, cwd?: string): TestErrorStack | undefined {
  let match = /^\s*at (.*) \((.*)\:([0-9]+)\:([0-9]+)\)$/.exec(line);
  if (!match) {
    match = /^\s*at (.*)\:([0-9]+)\:([0-9]+)$/.exec(line);
    if (!match) {
      return undefined;
    }
  }
  const [columnNo, lineNo, path, func] = match.reverse();
  let file = path;
  if (cwd && path.startsWith(cwd)) {
    file = path.slice(cwd.length);
    if (file.startsWith("/")) {
      file = file.slice(1);
    }
  }
  return {
    file,
    function: func !== line ? func : undefined,
    line: parseInt(lineNo),
    column: parseInt(columnNo),
  };
}

function parseSkip(line: string): number {
  const match = /^([0-9]+) tests (?:skipped|failed)\:$/.exec(line);
  if (match) {
    return parseInt(match[1]);
  }
  return 0;
}

function parseSummary(line: string): TestSummary | undefined {
  const match = /^Ran ([0-9]+) tests across ([0-9]+) files \[([0-9]+\.[0-9]+)(m?s)\]$/.exec(line);
  if (!match) {
    return undefined;
  }
  const [, tests, files, duration, unit] = match;
  return {
    pass: 0,
    fail: 0,
    skip: 0,
    tests: parseInt(tests),
    files: parseInt(files),
    duration: parseFloat(duration) * (unit === "s" ? 1000 : 1),
  };
}

function* listFiles(cwd: string, dir: string): Generator<string> {
  const dirents = readdirSync(join(cwd, dir), { withFileTypes: true });
  for (const dirent of dirents) {
    const { name } = dirent;
    if (name === "node_modules" || name.startsWith(".")) {
      continue;
    }
    const path = join(dir, name);
    if (dirent.isDirectory()) {
      yield* listFiles(cwd, path);
    } else if (dirent.isFile()) {
      yield path;
    }
  }
}

function stripAnsi(string: string): string {
  return string.replace(/\x1b\[[0-9;]*m/g, "");
}

function print(buffer: string | Uint8Array) {
  if (typeof buffer === "string") {
    buffer = new TextEncoder().encode(buffer);
  }
  let offset = 0;
  let length = buffer.byteLength;
  while (offset < length) {
    try {
      const n = writeSync(1, buffer);
      offset += n;
      if (offset < length) {
        try {
          fsyncSync(1);
        } catch {}
        buffer = buffer.slice(n);
      }
    } catch (error) {
      // @ts-ignore
      if (error.code === "EAGAIN") {
        continue;
      }
      throw error;
    }
  }
}

// FIXME: there is a bug that causes annotations to be duplicated
const seen = new Set<string>();

function annotate(type: string, arg?: string, args?: Record<string, unknown>): void {
  let line = `::${type}`;
  if (args) {
    line += " ";
    line += Object.entries(args)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
  }
  line += "::";
  if (arg) {
    line += arg;
  }
  line = line.replace(/\n/g, "%0A");
  if (seen.has(line)) {
    return;
  }
  seen.add(line);
  print(`\n${line}\n`);
}

async function* runTest(options: RunTestOptions): AsyncGenerator<RunTestResult, ParseTestResult> {
  const {
    cwd = process.cwd(),
    args = [],
    timeout = 60_000, // 1 min
    isolate = false,
  } = options;
  const paths: string[] = Array.from(listFiles(cwd, ""));
  const files: string[] = [];
  for (const path of paths) {
    if (!path.includes(".test.")) {
      continue;
    }
    if (!args.length) {
      files.push(path);
      continue;
    }
    for (const arg of args) {
      if (
        (arg.endsWith("/") && path.startsWith(arg)) ||
        (arg.includes(".") && path.endsWith(arg)) ||
        (!arg.endsWith("/") && !arg.includes(".") && path.includes(arg))
      ) {
        files.push(path);
        break;
      }
    }
  }
  const runSingleTest = async (args: string[]) => {
    const runner = spawn("bun", ["test", ...args], {
      cwd,
      env: {
        ...process.env,
        "FORCE_COLOR": "1",
      },
      stdio: "pipe",
      timeout,
    });
    let stderr = "";
    let stdout = "";
    const exitCode = await new Promise<number | null>(resolve => {
      runner.stdout.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8");
      });
      runner.stderr.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });
      runner.on("error", ({ name, message }) => {
        stderr += `${name}: ${message}`;
        resolve(null);
      });
      runner.on("exit", exitCode => {
        resolve(exitCode);
      });
    });
    const lines = stderr.split("\n").map(stripAnsi);
    const result = parseTest(lines, { cwd, paths });
    return {
      exitCode,
      stdout,
      stderr,
      ...result,
    };
  };
  if (!isolate) {
    const result = await runSingleTest(args);
    yield result;
    return result;
  }
  const tests = files.map(file => runSingleTest([file]));
  const results: RunTestResult[] = [];
  for (const test of tests) {
    const result = await test;
    results.push(result);
    yield result;
  }
  if (!results.length) {
    throw new Error("No tests found");
  }
  return {
    info: results.map(result => result.info).pop()!,
    files: results.flatMap(result => result.files),
    summary: results
      .map(result => result.summary)
      .reduce((summary, result) => {
        summary.pass += result.pass;
        summary.fail += result.fail;
        summary.skip += result.skip;
        summary.tests += result.tests;
        summary.files += result.files;
        summary.duration += result.duration;
        return summary;
      }),
  };
}

export type FormatTestOptions = {
  debug?: boolean;
  baseUrl?: string;
};

function formatTest(result: ParseTestResult, options?: FormatTestOptions): string {
  const { debug, baseUrl } = options ?? {};
  const count = (n: number, label?: string) => {
    return n ? (label ? `${n} ${label}` : `${n}`) : "";
  };
  const code = (content: string, lang?: string) => {
    return `\`\`\`${lang ?? ""}\n${content}\n\`\`\`\n`;
  };
  const link = (title: string, href?: string) => {
    if (href && baseUrl) {
      href = `${new URL(href, baseUrl)}`;
    }
    return href ? `[${title}](${href})` : title;
  };
  const table = (headers: string[], rows: unknown[][]) => {
    return [headers, headers.map(() => "-"), ...rows].map(row => `| ${row.join(" | ")} |`).join("\n");
  };
  const header = (level: number, content: string) => {
    return `${"#".repeat(level)} ${content}\n`;
  };
  const icon = {
    pass: "✅",
    fail: "❌",
    skip: "⏭️",
  };
  const files = table(
    ["File", "Status", "Pass", "Fail", "Skip", "Tests", "Duration"],
    result.files
      .filter(({ status }) => debug || status !== "pass")
      .sort((a, b) => {
        if (a.status === b.status) {
          return a.file.localeCompare(b.file);
        }
        return a.status.localeCompare(b.status);
      })
      .map(({ file, status, summary }) => [
        link(basename(file), file),
        icon[status],
        count(summary.pass),
        count(summary.fail),
        count(summary.skip),
        count(summary.tests),
        count(summary.duration, "ms"),
      ]),
  );
  const errors = result.files
    .filter(({ status }) => status === "fail")
    .sort((a, b) => a.file.localeCompare(b.file))
    .flatMap(({ file, tests }) => {
      return [
        header(2, link(basename(file), file)),
        ...tests
          .filter(({ status }) => status === "fail")
          .map(({ name, errors }) => {
            let content = header(3, name);
            let hasLink = false;
            if (errors) {
              content += errors
                .map(({ name, message, stack }) => {
                  let preview = code(`${name}: ${message}`, "diff");
                  if (stack?.length && baseUrl) {
                    const { file, line } = stack[0];
                    if (!is3rdParty(file) && !hasLink) {
                      const { href } = new URL(`${file}?plain=1#L${line}`, baseUrl);
                      content = link(content, href);
                      hasLink = true;
                    }
                  }
                  return preview;
                })
                .join("\n");
            } else {
              content += code("See logs for details");
            }
            return content;
          }),
      ];
    })
    .join("\n");
  return `${header(1, "Files")}
${files}

${header(1, "Errors")}
${errors}`;
}

function is3rdParty(file?: string): boolean {
  return !file || file.startsWith("/") || file.includes(":") || file.includes("..") || file.includes("node_modules/");
}

function printTest(result: RunTestResult): void {
  const isAction = process.env["GITHUB_ACTIONS"] === "true";
  const isSingle = result.files.length === 1;
  if (isSingle) {
    const { file, status } = result.files[0];
    if (isAction) {
      annotate("group", `${status.toUpperCase()} - ${file}`);
    } else {
      print(`\n${file}:\n`);
    }
  }
  print(result.stderr);
  print(result.stdout);
  if (!isAction) {
    return;
  }
  result.files
    .filter(({ status }) => status === "fail")
    .flatMap(({ tests }) => tests)
    .filter(({ status }) => status === "fail")
    .flatMap(({ name: title, errors }) =>
      errors?.forEach(({ name, message, stack }) => {
        const { file, line } = stack?.[0] ?? {};
        if (is3rdParty(file)) {
          return;
        }
        annotate("error", `${name}: ${message}`, {
          file,
          line,
          title,
        });
      }),
    );
  if (isSingle) {
    annotate("endgroup");
  }
}

async function main() {
  let args = [...process.argv.slice(2)];
  let timeout;
  let isolate;
  let quiet;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--timeout=")) {
      timeout = parseInt(arg.split("=").pop()!);
    } else if (arg.startsWith("--isolate")) {
      isolate = true;
    } else if (arg.startsWith("--quiet")) {
      quiet = true;
    }
  }
  args = args.filter(arg => !arg.startsWith("--"));
  const results = runTest({
    args,
    timeout,
    isolate,
  });
  let result: ParseTestResult;
  while (true) {
    const { value, done } = await results.next();
    if (done) {
      result = value;
      break;
    } else if (!quiet) {
      printTest(value);
    }
  }
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (!summaryPath) {
    return;
  }
  const sha = process.env["GITHUB_SHA"] ?? result.info.revision;
  const repo = process.env["GITHUB_REPOSITORY"] ?? "oven-sh/bun";
  const serverUrl = process.env["GITHUB_SERVER_URL"] ?? "https://github.com";
  const summary = formatTest(result, {
    debug: process.env["ACTIONS_STEP_DEBUG"] === "true",
    baseUrl: `${serverUrl}/${repo}/blob/${sha}/`,
  });
  appendFileSync(summaryPath, summary, "utf-8");
  process.exit(0);
}

function isMain() {
  return import.meta.main || import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  await main();
}
