// Regression test for https://github.com/oven-sh/bun/issues/33169
// In a multi-root workspace each folder must resolve its own folder-scoped
// `bun.runtime` / `bun.test.*` settings. The controller reads config through
// `getConfiguration(section, <folder uri>)` so VS Code applies folder overrides
// instead of a single workspace-global value.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { MockTestController, MockUri, MockWorkspaceFolder } from "./vscode-types.mock";

const DEFAULT_TEST_PATTERN = "**/*{.test.,.spec.,_test_,_spec_}{js,ts,tsx,jsx,mts,cts,cjs,mjs}";

// folder uri string -> fully-qualified setting -> value
const folderSettings: Record<string, Record<string, unknown>> = {
  "file:///repo/packages/api": {
    "bun.test.filePattern": "**/*.spec.ts",
    "bun.test.customFlag": "--coverage",
    "bun.test.customScript": "bun run test:ci",
    "bun.runtime": "/custom/bin/bun",
  },
  "file:///repo/packages/frontend": {
    "bun.test.filePattern": "**/*.test.tsx",
  },
};

class ScopedConfiguration {
  constructor(
    private readonly section: string,
    private readonly scopeKey: string | undefined,
  ) {}

  get<T>(key: string, defaultValue?: T): T | undefined {
    const full = this.section ? `${this.section}.${key}` : key;
    if (this.scopeKey) {
      const overrides = folderSettings[this.scopeKey];
      if (overrides && full in overrides) {
        return overrides[full] as T;
      }
    }
    return defaultValue;
  }
}

function vscodeFactory() {
  return {
    window: {
      createOutputChannel: () => ({ appendLine: () => {} }),
      visibleTextEditors: [],
      showErrorMessage: () => {},
    },
    workspace: {
      getConfiguration: (section?: string, scope?: { toString(): string }) =>
        new ScopedConfiguration(section ?? "", scope ? scope.toString() : undefined),
      onDidOpenTextDocument: () => ({ dispose() {} }),
      textDocuments: [],
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose() {} }),
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {},
      }),
      findFiles: async () => [],
    },
    Uri: MockUri,
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
  };
}

mock.module("vscode", vscodeFactory);

const { BunTestController } = await import("../bun-test-controller");

// `mock.module` is global and the module graph is evaluated with interleaved
// awaits, so re-assert this file's mock before each test to stay independent of
// the order in which other test files register their own vscode mock.
beforeEach(() => {
  mock.module("vscode", vscodeFactory);
});

function makeController(folderPath: string, name: string, index: number) {
  const folder = new MockWorkspaceFolder(MockUri.file(folderPath), name, index);
  const controller = new MockTestController(`bun:${folderPath}`, name);
  return new BunTestController(controller as any, folder as any, true);
}

describe("multi-root workspace config scoping (issue #33169)", () => {
  test("customFilePattern resolves each folder's own filePattern", () => {
    const api = makeController("/repo/packages/api", "api", 0);
    const frontend = makeController("/repo/packages/frontend", "frontend", 1);
    expect(api._internal.customFilePattern()).toBe("**/*.spec.ts");
    expect(frontend._internal.customFilePattern()).toBe("**/*.test.tsx");
  });

  test("getBunExecutionConfig resolves the folder's runtime, customScript and customFlag", () => {
    const api = makeController("/repo/packages/api", "api", 0);
    const apiConfig = api._internal.getBunExecutionConfig();
    expect(apiConfig.bunCommand).toBe("/custom/bin/bun");
    expect(apiConfig.testArgs).toEqual(["run", "test:ci", "--coverage"]);
  });

  test("a folder without overrides keeps the defaults and does not inherit another folder's settings", () => {
    const frontend = makeController("/repo/packages/frontend", "frontend", 1);
    expect(frontend._internal.customFilePattern()).toBe("**/*.test.tsx");

    const frontendConfig = frontend._internal.getBunExecutionConfig();
    expect(frontendConfig.bunCommand).toBe("bun");
    expect(frontendConfig.testArgs).toEqual(["test"]);
  });

  test("default pattern is used when no scope matches", () => {
    const other = makeController("/repo/packages/other", "other", 2);
    expect(other._internal.customFilePattern()).toBe(DEFAULT_TEST_PATTERN);
  });
});
