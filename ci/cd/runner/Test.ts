import { accessSync, existsSync, constants as fs, statSync } from "node:fs";
import { basename, dirname, sep } from "node:path";
import { getEnv, isGithubAction } from "../../machine/context/process.ts";
import { isBuildkite } from "../../machine/executor/buildkite.ts";
import { getRunnerOptions } from "./RunnerOptions.ts";

export interface VendorTest {
  cwd: string;
  packageManager: string;
  testRunner: string;
  testPaths: string[];
}

export interface TestEntry {
  url?: string;
  file: string;
  test: string;
  status: string;
  error?: TestError;
  duration?: number;
}

export interface TestError {
  url: string;
  file: string;
  line: number;
  col: number;
  name: string;
  stack: string;
}

export interface TestResult {
  testPath: string;
  ok: boolean;
  status: string;
  error: string | null | undefined;
  test?: TestEntry;
  tests?: TestEntry[];
  stdout: string;
  stdoutPreview: string;
  executions?: TestResult[];
  url?: string;
  file?: string;
}

export class Test {
  static getTestTimeout(testPath: string) {
    const {
      timeouts: { testTimeout, integrationTimeout },
    } = getRunnerOptions();
    if (/integration|3rd_party|docker/i.test(testPath)) {
      return integrationTimeout;
    }
    return testTimeout;
  }

  /**
   * @param {string} path
   * @returns {boolean}
   */
  static isJavaScript(path: any) {
    return /\.(c|m)?(j|t)sx?$/.test(basename(path));
  }

  /**
   * @param {string} path
   * @returns {boolean}
   */
  static isJavaScriptTest(path: any) {
    return Test.isJavaScript(path) && /\.test|spec\./.test(basename(path));
  }

  /**
   * @param {string} path
   * @returns {boolean}
   */
  static isTest(path: string) {
    if (path.replaceAll(sep, "/").includes("/test-cluster-") && path.endsWith(".js")) return true;
    if (path.replaceAll(sep, "/").startsWith("js/node/cluster/test-") && path.endsWith(".ts")) return true;
    return Test.isTestStrict(path);
  }

  static isTestStrict(path: string) {
    return Test.isJavaScript(path) && /\.test|spec\./.test(basename(path));
  }

  static isHidden(path: any) {
    return /node_modules|node.js/.test(dirname(path)) || /^\./.test(basename(path));
  }

  static getBuildLabel() {
    if (isBuildkite) {
      const label = getEnv("BUILDKITE_LABEL", false) || getEnv("BUILDKITE_GROUP_LABEL", false);
      if (label) {
        return label;
      }
    }

    if (isGithubAction) {
      const label = getEnv("GITHUB_WORKFLOW", false);
      if (label) {
        return label;
      }
    }
  }
  static isExecutable(execPath: any) {
    if (!existsSync(execPath) || !statSync(execPath).isFile()) {
      return false;
    }
    try {
      accessSync(execPath, fs.X_OK);
    } catch {
      return false;
    }
    return true;
  }
}
