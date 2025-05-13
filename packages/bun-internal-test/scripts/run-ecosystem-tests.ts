import { a, br, code, count, details, duration, h, percent, table, ul } from "html";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { Test, TestError, TestFile, TestStatus, TestSummary, printTest, runTests } from "runner";

const [filter] = process.argv.slice(2);
const packagesText = readFileSync(resolve("resources/packages.json"), "utf8");
const packagesList: Package[] = JSON.parse(packagesText);
const summaryPath = process.env["GITHUB_STEP_SUMMARY"];

type Package = {
  name: string;
  repository: {
    github: string;
    commit?: string;
  };
  test?: {
    runner: "bun" | "jest" | "qunit" | "mocha" | "tap";
    path: string;
    skip?: boolean | string;
    env?: Record<string, string>;
    args?: string[];
  };
};

let summary = h(2, "Summary");
let summaries: string[][] = [];
let errors = h(2, "Errors");

for (const pkg of packagesList) {
  const { name, test } = pkg;
  if (filter && !name.includes(filter)) {
    continue;
  }
  const cwd = gitClone(pkg);
  if (!test || test.skip) {
    continue;
  }
  const { runner, path, args, env } = test;
  const preload: string[] = [];
  if (runner === "qunit") {
    preload.push(resolve("runners/qunit/qunit.ts"));
  }
  if (runner === "tap" || runner === "mocha") {
    continue; // TODO
  }
  const tests = runTests({
    cwd,
    filters: [path],
    preload,
    args,
    env,
    timeout: 5000,
  });
  let result;
  while (true) {
    const { value, done } = await tests.next();
    if (done) {
      result = value;
      break;
    } else if (filter || value.summary.fail) {
      printTest(value);
    }
  }
  if (!summaryPath) {
    continue;
  }
  const { summary, files } = result;
  const baseUrl = htmlUrl(pkg);
  summaries.push([
    a(name, baseUrl),
    htmlStatus(summary),
    count(summary.pass),
    count(summary.fail),
    count(summary.skip),
    duration(summary.duration),
  ]);
  let breakdown = "";
  const isFailed = ({ status }: { status: TestStatus }) => status === "fail";
  for (const file of files.filter(isFailed)) {
    breakdown += h(3, a(file.file, htmlLink(baseUrl, file)));
    for (const error of file.errors ?? []) {
      breakdown += htmlError(error);
    }
    let entries: string[] = [];
    for (const test of file.tests.filter(isFailed)) {
      let entry = a(test.name, htmlLink(baseUrl, file, test));
      if (!test.errors?.length) {
        entries.push(entry);
        continue;
      }
      entry += br(2);
      for (const error of test.errors) {
        entry += htmlError(error);
      }
      entries.push(entry);
    }
    if (!entries.length && !file.errors?.length) {
      breakdown += code("Test failed, but no errors were found.");
    } else {
      breakdown += ul(entries);
    }
  }
  if (breakdown) {
    errors += details(a(name, baseUrl), breakdown);
  }
}

if (summaryPath) {
  let html = summary + table(["Package", "Status", "Passed", "Failed", "Skipped", "Duration"], summaries) + errors;
  appendFileSync(summaryPath, html, "utf-8");
}

function htmlLink(baseUrl: string, file: TestFile, test?: Test): string {
  const url = new URL(file.file, baseUrl);
  const errors = (test ? test.errors : file.errors) ?? [];
  loop: for (const { stack } of errors) {
    for (const location of stack ?? []) {
      if (test || location.file.endsWith(file.file)) {
        url.hash = `L${location.line}`;
        break loop;
      }
    }
  }
  return url.toString();
}

function htmlStatus(summary: TestSummary): string {
  const ratio = percent(summary.pass, summary.tests);
  if (ratio >= 95) {
    return `✅ ${ratio}%`;
  }
  if (ratio >= 75) {
    return `⚠️ ${ratio}%`;
  }
  return `❌ ${ratio}%`;
}

function htmlError(error: TestError): string {
  const { name, message, preview } = error;
  let result = code(`${name}: ${message}`, "diff");
  if (preview) {
    result += code(preview, "typescript");
  }
  return result;
}

function htmlUrl(pkg: Package): string {
  const { repository } = pkg;
  const { github, commit } = repository;
  return `https://github.com/${github}/tree/${commit}/`;
}

function gitClone(pkg: Package): string {
  const { name, repository } = pkg;
  const path = resolve(`packages/${name}`);
  if (!existsSync(path)) {
    const url = `https://github.com/${repository.github}.git`;
    spawnSync("git", ["clone", "--single-branch", "--depth=1", url, path], {
      stdio: "inherit",
    });
    spawnSync("bun", ["install"], {
      cwd: path,
      stdio: "inherit",
    });
  }
  const { stdout } = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: path,
    stdio: "pipe",
  });
  repository.commit = stdout.toString().trim();
  return path;
}

function resolve(path: string): string {
  return new URL(`../${path}`, import.meta.url).pathname;
}
