// This file parses the output of `bun test` and outputs
// a markdown summary and Github Action annotations.
//
// In the future, a version of this will be built-in to Bun.

import { spawn } from "node:child_process";
import { fsyncSync, readdirSync, symlinkSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export type TestInfo = {
  name: string;
  version: string;
  revision: string;
  os?: string;
  arch?: string;
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
  preview?: string;
  stack?: TestErrorStack[];
};

export type TestErrorStack = {
  file: string;
  function?: string;
  line: number;
  column?: number;
};

export type TestStatus = "pass" | "fail" | "skip" | "todo";

export type Test = {
  name: string;
  status: TestStatus;
  duration: number;
  errors?: TestError[];
};

export type TestSummary = {
  pass: number;
  fail: number;
  skip: number;
  todo: number;
  tests: number;
  files: number;
  duration: number;
};

export type RunTestsOptions = ParseTestOptions & {
  filters?: string[];
  preload?: string[];
  env?: Record<string, string>;
  args?: string[];
  timeout?: number;
};

export async function* runTests(options: RunTestsOptions = {}): AsyncGenerator<RunTestResult, ParseTestResult> {
  const { cwd = process.cwd(), filters, timeout, preload, env, args } = options;
  const knownPaths = [...listFiles(cwd)];
  const paths = [...findTests({ cwd, knownPaths, filters })];
  if (!paths.length) {
    throw new Error(`No tests found; ${knownPaths.length} files did not match: ${filters}`);
  }
  const startTest = (path: string) =>
    runTest({
      cwd,
      path,
      knownPaths,
      preload,
      timeout,
      env,
      args,
    });
  const results: RunTestResult[] = [];
  const batchSize = 10;
  for (let i = 0; i < paths.length; i += batchSize) {
    for (const test of paths.slice(i, i + batchSize).map(startTest)) {
      const result = await test;
      results.push(result);
      yield result;
    }
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
        summary.todo += result.todo;
        summary.tests += result.tests;
        summary.files += result.files;
        summary.duration += result.duration;
        return summary;
      }),
  };
}

export type RunTestOptions = ParseTestOptions & {
  path: string;
  preload?: string[];
  timeout?: number;
  env?: Record<string, string>;
  args?: string[];
};

export type RunTestResult = ParseTestResult & {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export async function runTest(options: RunTestOptions): Promise<RunTestResult> {
  const { cwd = process.cwd(), path, knownPaths, preload = [], timeout, env = {}, args = [] } = options;
  let file = path;
  if (!isTestJavaScript(file)) {
    const i = file.lastIndexOf(".");
    file = `${file.substring(0, i)}.test.${file.substring(i + 1)}`;
    try {
      symlinkSync(join(cwd, path), join(cwd, file));
    } catch {}
  }
  const { exitCode, stdout, stderr } = await bunSpawn({
    cwd,
    cmd: "bun",
    args: ["test", ...args, ...preload.flatMap(path => ["--preload", path]), file],
    env: {
      ...process.env,
      ...env,
      "FORCE_COLOR": "1",
    },
    timeout,
  });
  if (file !== path) {
    try {
      unlinkSync(join(cwd, file));
    } catch {}
  }
  const result = parseTest(stderr, { cwd, knownPaths });
  result.info.os ||= process.platform;
  result.info.arch ||= process.arch;
  if ("Bun" in globalThis && Bun.revision.startsWith(result.info.revision)) {
    result.info.revision = Bun.revision;
  }
  if (exitCode !== 0 && !result.summary.fail) {
    result.summary.fail = 1;
    result.files[0].summary.fail = 1;
    result.files[0].status = "fail";
  }
  return {
    exitCode,
    stdout,
    stderr,
    ...result,
  };
}

export function printTest(result: ParseTestResult | RunTestResult): void {
  const isAction = process.env["GITHUB_ACTIONS"] === "true";
  const isSingle = result.files.length === 1;
  if (isSingle) {
    const { file, status } = result.files[0];
    if (isAction) {
      printAnnotation("group", `${status.toUpperCase()} - ${file}`);
    } else {
      print(`\n${file}:\n`);
    }
  }
  if ("stderr" in result) {
    print(result.stderr);
    print(result.stdout);
  }
  if (!isAction) {
    print("\n");
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
        printAnnotation("error", `${name}: ${message}`, {
          file,
          line,
          title,
        });
      }),
    );
  if (isSingle) {
    printAnnotation("endgroup");
  }
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
const annotations = new Set<string>();

function printAnnotation(type: string, arg?: string, args?: Record<string, unknown>): void {
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
  if (annotations.has(line)) {
    return;
  }
  annotations.add(line);
  print(`\n${line}\n`);
}

function is3rdParty(file?: string): boolean {
  return !file || file.startsWith("/") || file.includes(":") || file.includes("..") || file.includes("node_modules/");
}

export type ParseTestOptions = {
  cwd?: string;
  knownPaths?: string[];
};

export type ParseTestResult = {
  info: TestInfo;
  files: TestFile[];
  summary: TestSummary;
};

export function parseTest(stderr: string, options: ParseTestOptions = {}): ParseTestResult {
  const { cwd, knownPaths } = options;
  const linesAnsi = stderr.split("\n");
  const lines = linesAnsi.map(stripAnsi);
  let info: TestInfo | undefined;
  const parseInfo = (line: string): TestInfo | undefined => {
    const match = /^(bun (?:wip)?test) v([0-9\.]+) \(([0-9a-z]+)\)$/.exec(line);
    if (!match) {
      return undefined;
    }
    const [, name, version, sha] = match;
    return {
      name,
      version,
      revision: sha,
    };
  };
  let files: TestFile[] = [];
  let file: TestFile | undefined;
  const parseFile = (line: string): TestFile | undefined => {
    let file = line.slice(0, -1);
    if (!isJavaScript(file) || !line.endsWith(":")) {
      return undefined;
    }
    for (const path of knownPaths ?? []) {
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
        todo: 0,
        duration: 0,
      },
    };
  };
  const parseTestLine = (line: string): Test | undefined => {
    const match = /^(✓|‚úì|✗|‚úó|»|-|✎) (.*)$/.exec(line);
    if (!match) {
      return undefined;
    }
    const [, icon, name] = match;
    let status: TestStatus = "fail";
    switch (icon) {
      case "✓":
      case "‚úì":
        status = "pass";
        break;
      case "✗":
      case "‚úó":
        status = "fail";
        break;
      case "»":
      case "-":
        status = "skip";
        break;
      case "✎":
        status = "todo";
        break;
    }
    const match2 = /^(.*) \[([0-9]+\.[0-9]+)(m?s)\]$/.exec(name);
    if (!match2) {
      return {
        name,
        status,
        duration: 0,
      };
    }
    const [, title, duration, unit] = match2;
    return {
      name: title,
      status,
      duration: parseFloat(duration ?? "0") * (unit === "ms" ? 1000 : 1) || 0,
    };
  };
  let errors: TestError[] = [];
  let error: TestError | undefined;
  const parseError = (line: string): TestError | undefined => {
    const match = /^(.*error|timeout)\: (.*)$/i.exec(line);
    if (!match) {
      return undefined;
    }
    const [, name, message] = match;
    return {
      name: name === "error" ? "Error" : name,
      message,
    };
  };
  const parseErrorStack = (line: string): TestErrorStack | undefined => {
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
  };
  const parseErrorPreview = (line: string): string | undefined => {
    if (line.endsWith("^") || /^[0-9]+ \| /.test(line)) {
      return line;
    }
    return undefined;
  };
  let summary: TestSummary | undefined;
  const parseSummary = (line: string): TestSummary | undefined => {
    const match = /^Ran ([0-9]+) tests across ([0-9]+) files\. .* \[([0-9]+\.[0-9]+)(m?s)\]$/.exec(line);
    if (!match) {
      return undefined;
    }
    const [, tests, files, duration, unit] = match;
    return {
      pass: 0,
      fail: 0,
      skip: 0,
      todo: 0,
      tests: parseInt(tests),
      files: parseInt(files),
      duration: parseFloat(duration) * (unit === "s" ? 1000 : 1),
    };
  };
  const createSummary = (files: TestFile[]): TestSummary => {
    const summary = {
      pass: 0,
      fail: 0,
      skip: 0,
      todo: 0,
      tests: 0,
      files: 0,
      duration: 0,
    };
    for (const file of files) {
      summary.files++;
      summary.duration += file.summary.duration;
      for (const test of file.tests) {
        summary.tests++;
        summary[test.status]++;
      }
      if (file.errors?.length) {
        summary.fail++;
      }
    }
    return summary;
  };
  const parseSkip = (line: string): number => {
    const match = /^([0-9]+) tests (?:skipped|failed|todo)\:$/.exec(line);
    if (match) {
      return parseInt(match[1]);
    }
    return 0;
  };
  const endOfFile = (file?: TestFile): void => {
    if (file && !file.tests.length && errors.length) {
      file.errors = errors;
      errors = [];
    }
  };
  let errorStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!info && !(info = parseInfo(line))) {
      continue;
    }
    const newFile = parseFile(line);
    if (newFile) {
      endOfFile(file);
      files.push((file = newFile));
      continue;
    }
    const newError = parseError(line);
    if (newError) {
      errorStart = i;
      errors.push((error = newError));
      for (let j = 1; j < 8 && i - j >= 0; j++) {
        const line = lines[i - j];
        const preview = parseErrorPreview(line);
        if (!preview) {
          break;
        }
        if (error.preview) {
          error.preview = preview + "\n" + error.preview;
        } else {
          error.preview = preview;
        }
      }
      continue;
    }
    const newStack = parseErrorStack(line);
    if (newStack) {
      if (error) {
        error.stack ||= [];
        error.stack.push(newStack);
        for (let j = errorStart + 1; j < i && error.stack.length === 1; j++) {
          error.message += "\n" + lines[j];
        }
      } else {
        // TODO: newStack and !error
      }
      continue;
    }
    const newTest = parseTestLine(line);
    if (newTest) {
      if (error && newTest.status === "skip") {
        continue; // Likely a false positive from error message
      }
      if (error) {
        for (let j = errorStart + 1; j < i - 1 && !error.stack?.length; j++) {
          error.message += "\n" + lines[j];
        }
        error = undefined;
      }
      if (errors.length) {
        newTest.errors = errors;
        errors = [];
      }
      file!.tests.push(newTest);
      continue;
    }
    const newSummary = parseSummary(line);
    if (newSummary) {
      summary = newSummary;
      break;
    }
    i += parseSkip(line);
  }
  endOfFile(file);
  if (!info) {
    throw new Error("No tests found; did the test runner crash?");
  }
  summary ||= createSummary(files);
  const count = (status: TestStatus): number => {
    return files.reduce((n, file) => n + file.tests.filter(test => test.status === status).length, 0);
  };
  summary.pass ||= count("pass");
  summary.fail ||= count("fail");
  summary.skip ||= count("skip");
  summary.todo ||= count("todo");
  const getStatus = (summary: TestSummary) => {
    return summary.fail ? "fail" : !summary.pass && summary.skip ? "skip" : "pass";
  };
  if (files.length === 1) {
    files[0].summary = { ...summary };
    files[0].status = getStatus(summary);
  } else {
    for (const file of files) {
      const summary = createSummary([file]);
      file.summary = summary;
      file.status = getStatus(summary);
    }
  }
  return {
    info,
    files,
    summary,
  };
}

function stripAnsi(string: string): string {
  return string.replace(/\x1b\[[0-9;]*m/g, "");
}

export type FindTestOptions = {
  cwd?: string;
  knownPaths?: string[];
  filters?: string[];
};

export function* findTests(options: FindTestOptions = {}): Generator<string> {
  const { cwd = process.cwd(), knownPaths, filters = [] } = options;
  const paths = knownPaths ?? listFiles(cwd);
  for (const path of paths) {
    if (!isJavaScript(path)) {
      continue;
    }
    let match = filters.length === 0;
    for (const filter of filters) {
      if (isGlob(filter)) {
        match = isGlobMatch(filter, path);
      } else if (filter.endsWith("/")) {
        match = path.startsWith(filter);
      } else if (isJavaScript(filter)) {
        match = path.endsWith(filter);
      } else {
        match = path.includes(filter);
      }
      if (match) {
        break;
      }
    }
    if (!match) {
      continue;
    }
    yield path;
  }
}

function* listFiles(cwd: string, dir: string = ""): Generator<string> {
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

function isJavaScript(path: string): boolean {
  return /\.(c|m)?(t|j)sx?$/.test(path);
}

function isTestJavaScript(path: string): boolean {
  return /\.(test|spec)\.(c|m)?(t|j)sx?$/.test(path);
}

function isGlob(path: string): boolean {
  return path.includes("*");
}

function isGlobMatch(glob: string, path: string): boolean {
  return new RegExp(`^${glob.replace(/\*/g, ".*")}$`).test(path);
}

export type SpawnOptions = {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
};

export type SpawnResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export async function nodeSpawn(options: SpawnOptions): Promise<SpawnResult> {
  const { cmd, args = [], cwd, env, timeout } = options;
  const subprocess = spawn(cmd, args, {
    cwd,
    env,
    timeout,
    stdio: "pipe",
  });
  let stderr = "";
  let stdout = "";
  subprocess.stdout.on("data", (data: Buffer) => {
    stdout += data.toString("utf-8");
  });
  subprocess.stderr.on("data", (data: Buffer) => {
    stderr += data.toString("utf-8");
  });
  const exitCode = await new Promise<number | null>(resolve => {
    subprocess.on("error", ({ name, message }) => {
      stderr += `${name}: ${message}`;
      resolve(null);
    });
    subprocess.on("exit", exitCode => {
      resolve(exitCode);
    });
  });
  return {
    exitCode,
    stdout,
    stderr,
  };
}

export async function bunSpawn(options: SpawnOptions): Promise<SpawnResult> {
  const { cmd, args = [], cwd, env, timeout } = options;
  const subprocess = Bun.spawn({
    cwd,
    env,
    cmd: [cmd, ...args],
    stdout: "pipe",
    stderr: "pipe",
    lazy: false,
  });
  const consume = async (stream?: ReadableStream) => {
    let result = "";
    const decoder = new TextDecoder();
    for await (const chunk of stream ?? []) {
      result += decoder.decode(chunk);
    }
    return result;
  };
  const exitCode = await Promise.race([
    timeout ? Bun.sleep(timeout).then(() => null) : subprocess.exited,
    subprocess.exited,
  ]);
  if (!subprocess.killed) {
    subprocess.kill();
  }
  const [stdout, stderr] = await Promise.all([consume(subprocess.stdout), consume(subprocess.stderr)]);
  return {
    exitCode,
    stdout,
    stderr,
  };
}

async function main() {
  let filters = [...process.argv.slice(2)];
  let timeout;
  let isolate;
  let quiet;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];
    if (filter.startsWith("--timeout=")) {
      timeout = parseInt(filter.split("=").pop()!);
    } else if (filter.startsWith("--isolate")) {
      isolate = true;
    } else if (filter.startsWith("--quiet")) {
      quiet = true;
    }
  }
  filters = filters.filter(filter => !filter.startsWith("--"));
  const results = runTests({
    filters,
    timeout,
  });
  let result;
  while (true) {
    const { value, done } = await results.next();
    if (done) {
      result = value;
      break;
    } else if (!quiet) {
      printTest(value);
    }
  }
  process.exit(0);
}

function isMain() {
  // @ts-ignore
  return import.meta.main || import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  await main();
}
