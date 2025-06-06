import { a, br, code, count, duration, h, table, ul } from "html";
import { appendFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { TestError, TestStatus, printTest, runTests } from "runner";

const cwd = resolve(import.meta.dir, "..", "..", "..", "test");
const filters = process.argv.slice(2); // TODO

let result;
const tests = runTests({
  cwd,
  filters: ["*.test.ts", "*.test.js", "*.test.cjs", "*.test.mjs", "*.test.jsx", "*.test.tsx"],
  env: {
    // "BUN_GARBAGE_COLLECTOR_LEVEL": "2"
  },
  timeout: 30_000,
});

while (true) {
  const { value, done } = await tests.next();
  if (done) {
    result = value;
    break;
  } else {
    printTest(value);
  }
}

const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
const outputPath = process.env["GITHUB_OUTPUT"];
if (summaryPath) {
  const server = process.env["GITHUB_SERVER_URL"] ?? "https://github.com";
  const repository = process.env["GITHUB_REPOSITORY"] ?? "oven-sh/bun";
  const baseUrl = `${server}/${repository}/tree/${result.info.revision}/test/`;

  let failures: string = "";
  let summaries: string[][] = [];
  let totalSummary = [
    icon("pass") + " " + result.summary.pass,
    icon("fail") + " " + result.summary.fail,
    icon("skip") + " " + result.summary.skip,
    icon("todo") + " " + result.summary.todo,
    duration(result.summary.duration),
  ];

  const sortedFiles = result.files.sort((a, b) => {
    if (a.status === b.status) {
      return a.file.localeCompare(b.file);
    }
    const order = {
      fail: 10,
      pass: 0,
      skip: -1,
      todo: -2,
    };
    return order[b.status] - order[a.status];
  });

  for (const { file, status, summary } of sortedFiles) {
    summaries.push([
      a(basename(file), baseUrl, file),
      icon(status),
      count(summary.pass),
      count(summary.fail),
      count(summary.skip),
      count(summary.todo),
      duration(summary.duration),
    ]);
  }

  const failedFiles = sortedFiles.filter(({ status }) => status === "fail");

  for (const { file, tests, errors } of failedFiles) {
    const testErrors: TestError[] = [];

    if (errors?.length) {
      testErrors.push(...errors);
    }
    for (const { errors } of tests) {
      if (errors?.length) {
        testErrors.push(...errors);
      }
    }

    const failedTests = tests.filter(({ status }) => status === "fail");

    const lines: string[] = [];
    for (const { name, errors } of failedTests) {
      let line = a(name, link(baseUrl, file, errors));
      if (!errors?.length) {
        lines.push(line);
        continue;
      }
      line += br(2);
      for (const error of errors) {
        line += preview(error);
      }
      lines.push(line);
    }

    failures += h(3, a(file, link(baseUrl, file, testErrors)));
    failures += ul(lines);
  }

  let summary =
    h(2, "Summary") +
    table(["Passed", "Failed", "Skipped", "Todo", "Duration"], [totalSummary]) +
    table(["File", "Status", "Passed", "Failed", "Skipped", "Todo", "Duration"], summaries) +
    h(2, "Errors") +
    failures;
  appendFileSync(summaryPath, summary, "utf-8");

  if (outputPath && failedFiles.length) {
    appendFileSync(outputPath, `\nfailing_tests_count=${failedFiles.length}`, "utf-8");
    const rng = Math.ceil(Math.random() * 10_000);
    const value = failedFiles.map(({ file }) => ` - \`${file}\``).join("\n");
    appendFileSync(outputPath, `\nfailing_tests<<${rng}\n${value}\n${rng}`, "utf-8");
  }
}

function icon(status: TestStatus) {
  switch (status) {
    case "pass":
      return "✅";
    case "fail":
      return "❌";
    case "skip":
      return "⏭️";
    case "todo":
      return "📝";
  }
}

function link(baseUrl: string, fileName: string, errors?: TestError[]): string {
  const url = new URL(fileName, baseUrl);
  loop: for (const { stack } of errors ?? []) {
    for (const location of stack ?? []) {
      if (location.file.endsWith(fileName)) {
        url.hash = `L${location.line}`;
        break loop;
      }
    }
  }
  return url.toString();
}

function preview(error: TestError): string {
  const { name, message, preview } = error;
  let result = code(`${name}: ${message}`, "diff");
  if (preview) {
    result += code(preview, "typescript");
  }
  return result;
}
