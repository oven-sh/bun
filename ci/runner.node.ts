#!/usr/bin/env node --experimental-strip-types

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { formatTestToMarkdown } from "./cd/runner/output.ts";
import { getAnsi, getExitCode } from "./cd/runner/parse.ts";
import { getExecPath } from "./cd/runner/path.ts";
import { getRunnerOptions, setRunnerCwd } from "./cd/runner/RunnerOptions.ts";
import { RunnerTests } from "./cd/runner/RunnerTests.ts";
import { Spawn } from "./cd/runner/Spawn.ts";
import { type TestResult, type VendorTest } from "./cd/runner/Test.ts";
import { getRevision } from "./machine/code/git.ts";
import { isCI, isGithubAction, printEnvironment, startGroup } from "./machine/context/process.ts";
import { getExecPathFromBuildKite, isBuildkite } from "./machine/executor/buildkite.ts";

export class RunnerRunTests {
  static runTests = async (): Promise<TestResult[]> => {
    const { timeouts, testsPath, cwd, options } = getRunnerOptions();
    const { spawnTimeout } = timeouts;

    let execPath;
    if (options["step"]) {
      downloadLoop: for (let i = 0; i < 10; i++) {
        execPath = await getExecPathFromBuildKite(options["step"]);
        for (let j = 0; j < 10; j++) {
          const { error } = spawnSync(execPath, ["--version"], {
            encoding: "utf-8",
            timeout: spawnTimeout,
            env: {
              PATH: process.env.PATH,
              BUN_DEBUG_QUIET_LOGS: "1",
            },
          });
          if (!error) {
            break downloadLoop;
          }
          const { code } = error as Error & { code: string };
          if (code === "EBUSY") {
            console.log("Bun appears to be busy, retrying...");
            continue;
          }
          if (code === "UNKNOWN") {
            console.log("Bun appears to be corrupted, downloading again...");
            rmSync(execPath, { force: true });
            continue downloadLoop;
          }
        }
      }
    } else {
      execPath = getExecPath(options["exec-path"]);
    }
    console.log("Bun:", execPath);

    const revision = getRevision({ execPath, spawnTimeout });
    console.log("Revision:", revision);

    const tests = RunnerTests.getRelevantTests(testsPath);
    console.log("Running tests:", tests.length);

    /** @type {VendorTest[] | undefined} */
    let vendorTests: VendorTest[] | undefined;
    let vendorTotal = 0;
    if (/true|1|yes|on/i.test(options["vendor"]) || (isCI && typeof options["vendor"] === "undefined")) {
      vendorTests = await RunnerTests.getVendorTests(cwd);
      if (vendorTests.length) {
        vendorTotal = vendorTests.reduce((total, { testPaths }) => total + testPaths.length + 1, 0);
        console.log("Running vendor tests:", vendorTotal);
      }
    }

    let i = 0;
    let total = vendorTotal + tests.length + 2;
    const results: TestResult[] = [];

    const runTest = async (title: string, fn: () => Promise<TestResult> | Promise<void>): Promise<TestResult> => {
      const label = `${getAnsi("gray")}[${++i}/${total}]${getAnsi("reset")} ${title}`;
      const result: TestResult = await startGroup(label, async () => {
        // Stack approach.
        let inner: ReturnType<typeof fn>;
        let result: Awaited<typeof inner> = undefined;
        let attempts = 0;
        let executions: (typeof inner)[] = [];
        do {
          attempts++;
          inner = fn();
          if (inner instanceof Promise) {
            result = (await fn()) ?? undefined;
          } else {
            result = inner;
          }

          if (result !== undefined) {
            if (result.ok) {
              break;
            } else {
              executions.push(inner);
            }
          } else {
            throw Error("Unable to retrieve test results");
          }
        } while (attempts <= 3);
        return Promise.resolve({ inner, executions });
      });

      results.push(result);

      if (isBuildkite) {
        const { ok, error, stdoutPreview } = result;
        if (title.startsWith("vendor")) {
          const markdown = formatTestToMarkdown({ ...result, testPath: title });
          if (markdown) {
            // reportAnnotationToBuildKite({ label: title, content: markdown, style: "warning", priority: 5 });
          }
        } else {
          const markdown = formatTestToMarkdown(result);
          if (markdown) {
            // reportAnnotationToBuildKite({ label: title, content: markdown, style: "error" });
          }
        }

        if (!ok) {
          const label = `${getAnsi("red")}[${i}/${total}] ${title} - ${error}${getAnsi("reset")}`;
          startGroup(label, () => {
            // @ts-ignore
            process.stderr.write(stdoutPreview);
          });
        }
      }

      if (isGithubAction) {
        const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
        if (summaryPath) {
          const longMarkdown = formatTestToMarkdown(result);
          appendFileSync(summaryPath, longMarkdown);
        }
        const shortMarkdown = formatTestToMarkdown(result, true);
        appendFileSync("comment.md", shortMarkdown);
      }

      if (options["bail"] && !result.ok) {
        // @ts-ignore
        process.exit(getExitCode("fail"));
      }

      return result;
    };

    for (const path of [cwd, testsPath]) {
      const title = relative(cwd, join(path, "package.json")).replace(/\\/g, "/");
      await runTest(title, async () => Spawn.spawnBunInstall(execPath, { cwd: path, timeouts }));
    }

    if (results.every(({ ok }) => ok)) {
      for (const testPath of tests) {
        const title = relative(cwd, join(testsPath, testPath)).replace(/\\/g, "/");
        await runTest(title, async () =>
          Spawn.spawnBunTest(execPath, join("test", testPath), {
            cwd,
          }),
        );
      }
    }

    if (vendorTests?.length) {
      for (const { cwd: vendorPath, packageManager, testRunner, testPaths } of vendorTests) {
        if (!testPaths.length) {
          continue;
        }

        const packageJson = join(relative(cwd, vendorPath), "package.json").replace(/\\/g, "/");
        if (packageManager === "bun") {
          const { ok } = await runTest(packageJson, () =>
            Spawn.spawnBunInstall(execPath, { cwd: vendorPath, timeouts }),
          );
          if (!ok) {
            continue;
          }
        } else {
          throw new Error(`Unsupported package manager: ${packageManager}`);
        }

        for (const testPath of testPaths) {
          const title = join(relative(cwd, vendorPath), testPath).replace(/\\/g, "/");

          if (testRunner === "bun") {
            await runTest(title, () => Spawn.spawnBunTest(execPath, testPath, { cwd: vendorPath }));
          } else {
            const testRunnerPath = join(cwd, "test", "runners", `${testRunner}.ts`);
            if (!existsSync(testRunnerPath)) {
              throw new Error(`Unsupported test runner: ${testRunner}`);
            }
            await runTest(title, () =>
              Spawn.spawnBunTest(execPath, testPath, {
                cwd: vendorPath,
                args: ["--preload", testRunnerPath],
              }),
            );
          }
        }
      }
    }

    const failedTests = results.filter(({ ok }) => !ok);
    if (isGithubAction) {
      reportOutputToGitHubAction("failing_tests_count", failedTests.length);
      const markdown = formatTestToMarkdown(failedTests);
      reportOutputToGitHubAction("failing_tests", markdown);
    }

    if (!isCI) {
      console.log("-------");
      console.log("passing", results.length - failedTests.length, "/", results.length);
      for (const { testPath } of failedTests) {
        console.log("-", testPath);
      }
    }
    return results;
  };
}

/**
 * @param {string} signal
 */
function onExit(signal: string) {
  const label = `${getAnsi("red")}Received ${signal}, exiting...${getAnsi("reset")}`;
  startGroup(label, () => {
    // @ts-ignore
    process.exit(getExitCode("cancel"));
  });
}

export async function main() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    // @ts-ignore
    process.on(signal, () => onExit(signal));
  }
  // @ts-ignore
  setRunnerCwd(import.meta.dirname ? dirname(import.meta.dirname) : process.cwd());

  printEnvironment();
  const results = await RunnerRunTests.runTests();
  const ok = results.every(({ ok }) => ok);
  // @ts-ignore
  process.exit(getExitCode(ok ? "pass" : "fail"));
}

await main();
