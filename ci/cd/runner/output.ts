import { getBuildUrl, getFileUrl, isGithubAction } from "../../machine/context/process.ts";
import { isBuildkite } from "../../machine/executor/buildkite.ts";
import { getRunnerOptions } from "./RunnerOptions.ts";
import { Test, TestError, type TestResult } from "./Test.ts";
import { escapeCodeBlock, escapeHtml, getAnsi, parseDuration, stripAnsi, unescapeGitHubAction } from "./parse.ts";

/**
 * @param {string} testPath
 * @returns {number}
 */
export function getTestTimeout(testPath: string) {
  const {
    timeouts: { testTimeout, integrationTimeout },
  } = getRunnerOptions();

  if (/integration|3rd_party|docker/i.test(testPath)) {
    return integrationTimeout;
  }
  return testTimeout;
}

/**
 * @param {NodeJS.WritableStream} io
 * @param {string} chunk
 */
export function pipeTestStdout(io: { write: (arg0: any) => void }, chunk: string) {
  if (isGithubAction) {
    io.write(chunk.replace(/\:\:(?:end)?group\:\:.*(?:\r\n|\r|\n)/gim, ""));
  } else if (isBuildkite) {
    io.write(chunk.replace(/(?:---|\+\+\+|~~~|\^\^\^) /gim, " ").replace(/\:\:.*(?:\r\n|\r|\n)/gim, ""));
  } else {
    io.write(chunk.replace(/\:\:.*(?:\r\n|\r|\n)/gim, ""));
  }
}

type TestOutput = {
  stdout: string;
  tests: TestResult[];
  errors: TestError[];
};
export function parseTestStdout(stdout: string, testPath: string | undefined): TestOutput {
  const tests: TestResult[] = [];
  const errors: TestError[] = [];

  let lines: string[] = [];
  let skipCount = 0;
  let testErrors: TestError[] = [];
  let done: boolean | undefined;
  for (const chunk of stdout.split("\n")) {
    const string = stripAnsi(chunk);

    if (!string.startsWith("::")) {
      lines.push(chunk);

      if (string.startsWith("✓") || string.startsWith("»") || string.startsWith("✎")) {
        skipCount++;
      } else {
        // If there are more than 3 consecutive non-failing tests,
        // omit the non-failing tests between them.
        if (skipCount > 3) {
          const removeStart = lines.length - skipCount;
          const removeCount = skipCount - 2;
          const omitLine = `${getAnsi("gray")}... omitted ${removeCount} tests ...${getAnsi("reset")}`;
          lines.splice(removeStart, removeCount, omitLine);
        }
        skipCount = 0;
      }
    }

    // Once the summary is printed, exit early so tests aren't double counted.
    // This needs to be changed if multiple files are run in a single test run.
    if (done || string.startsWith("::endgroup")) {
      done ||= true;
      continue;
    }

    if (string.startsWith("::error")) {
      const eol = string.indexOf("::", 8);
      const message = unescapeGitHubAction(string.substring(eol + 2));
      const { file, line, col, title } = Object.fromEntries(
        string
          .substring(8, eol)
          .split(",")
          .map(entry => entry.split("=")),
      );

      const errorPath = file || testPath;
      const error = {
        url: getFileUrl(errorPath, line)?.toString() ?? "invalid url",
        file: errorPath,
        line,
        col,
        name: title,
        stack: `${title}\n${message}`,
      };

      errors.push(error);
      testErrors.push(error);
      continue;
    }

    for (const { emoji, text } of [
      { emoji: "✓", text: "pass" },
      { emoji: "✗", text: "fail" },
      { emoji: "»", text: "skip" },
      { emoji: "✎", text: "todo" },
    ]) {
      if (!string.startsWith(emoji)) {
        continue;
      }

      const eol = string.lastIndexOf(" [") || undefined;
      const test = string.substring(1 + emoji.length, eol);
      const duration = eol ? string.substring(eol + 2, string.lastIndexOf("]")) : undefined;

      tests.push({
        url: getFileUrl(testPath)?.toString() ?? "invalid url",
        file: testPath,
        test,
        status: text,
        errors: testErrors,
        duration: parseDuration(duration ?? "none"),
      });

      for (let error of testErrors) {
        // @ts-ignore
        error.test = test;
      }
      testErrors = [];
    }
  }

  let preview: string;
  const removeCount = lines.length - 100;
  if (removeCount > 10) {
    const omitLine = `${getAnsi("gray")}... omitted ${removeCount} lines ...${getAnsi("reset")}\n`;
    preview = [omitLine, ...lines.slice(-100)].join("\n");
  } else {
    preview = lines.join("\n");
  }

  return {
    tests,
    errors,
    stdout: preview,
  };
}

export function getTestLabel() {
  return Test.getBuildLabel()?.replace(" - test-bun", "");
}

/**
 * @param  {TestResult | TestResult[]} result
 * @param  {boolean} concise
 * @returns {string}
 */
export function formatTestToMarkdown(result: TestResult | TestResult[], concise?: boolean) {
  const results = Array.isArray(result) ? result : [result];
  const buildLabel = getTestLabel();
  const buildUrl = getBuildUrl();
  const platform = buildUrl ? `<a href="${buildUrl}">${buildLabel}</a>` : buildLabel;

  let markdown = "";
  for (const { testPath, ok, tests, error, stdoutPreview: stdout } of results) {
    if (ok || error === "SIGTERM") {
      continue;
    }

    let errorLine: number | undefined;
    for (const { error } of tests) {
      if (!error) {
        continue;
      }
      const { file, line } = error;
      if (line) {
        errorLine = line;
        break;
      }
    }

    const testTitle = testPath.replace(/\\/g, "/");
    const testUrl = getFileUrl(testPath, errorLine);

    if (concise) {
      markdown += "<li>";
    } else {
      markdown += "<details><summary>";
    }

    if (testUrl) {
      markdown += `<a href="${testUrl}"><code>${testTitle}</code></a>`;
    } else {
      markdown += `<a><code>${testTitle}</code></a>`;
    }
    if (error) {
      markdown += ` - ${error}`;
    }
    markdown += ` on ${platform}`;

    if (concise) {
      markdown += "</li>\n";
    } else {
      markdown += "</summary>\n\n";
      if (isBuildkite) {
        const preview = escapeCodeBlock(stdout);
        markdown += `\`\`\`terminal\n${preview}\n\`\`\`\n`;
      } else {
        const preview = escapeHtml(stripAnsi(stdout));
        markdown += `<pre><code>${preview}</code></pre>\n`;
      }
      markdown += "\n\n</details>\n\n";
    }
  }

  return markdown;
}
