import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FindTestOptions, ParseTestResult, RunTestResult } from "./runner";
import { bunSpawn, findTests, nodeSpawn, runTest, runTests } from "./runner";

describe("runTests()", () => {
  const cwd = createFs({
    "example1.test.ts": "",
    "example2.spec.js": `
      import { test, expect } from "bun:test";

      test("this should pass", () => {
        expect(true).toBe(true);
      });
    `,
    "example3.test.mjs": `
      import { test, expect } from "bun:test";

      test("this should fail", () => {
        expect(true).toBe(false);
      });

      test("this should timeout", async () => {
        await Bun.sleep(2);
      }, 1);
    `,
    "path": {
      "to": {
        "example4.test.ts": `
          import { test, expect } from "bun:test";

          test.skip("this should skip", () => {
            expect(true).toBe(true);
          });

          test.todo("this should todo");

          test.todo("this should todo and fail", () => {
            expect(true).toBe(false);
          });

          test.todo("this should todo and pass", () => {
            expect(true).toBe(true);
          });
        `,
      },
    },
  });
  test("can run all tests", async () => {
    const results = runTests({ cwd });
    while (true) {
      const { value, done } = await results.next();
      toMatchResult(value);
      if (done) {
        break;
      }
    }
  });
});

describe("runTest()", () => {
  const cwd = createFs({
    "example1.ts": `
      import { test, expect } from "bun:test";

      test("this should pass", () => {
        expect(true).toBe(true);
      });

      test("this should fail", () => {
        expect(true).toBe(false);
      });

      test.skip("this should skip", () => {
        expect(true).toBe(true);
      });

      test.todo("this should todo");
    `,
    "path": {
      "to": {
        "example2.test.ts": `
          import { test, expect } from "bun:test";

          test("this should pass", () => {
            expect(true).toBe(true);
          });
        `,
      },
    },
    "preload": {
      "preload.test.ts": `
        import { test, expect } from "bun:test";

        test("test should have preloaded", () => {
          expect(globalThis.preload).toBe(true);
        });
      `,
      "preload.ts": `
        globalThis.preload = true;
      `,
    },
  });
  test("can run a test", async () => {
    const result = await runTest({
      cwd,
      path: "path/to/example2.ts",
    });
    toMatchResult(result);
  });
  test("can run a test with a symlink", async () => {
    const result = await runTest({
      cwd,
      path: "example1.ts",
    });
    toMatchResult(result);
  });
  test("can run a test with a preload", async () => {
    const result = await runTest({
      cwd,
      path: "preload/preload.test.ts",
      preload: ["./preload/preload.ts"],
    });
    toMatchResult(result);
  });
});

function toMatchResult(result: ParseTestResult | RunTestResult): void {
  if (result.summary.duration) {
    result.summary.duration = 1;
  }
  result.info.revision = "";
  result.info.version = "";
  result.info.os = undefined;
  result.info.arch = undefined;
  for (const file of result.files) {
    if (file.summary.duration) {
      file.summary.duration = 1;
    }
    for (const test of file.tests) {
      if (test.duration) {
        test.duration = 1;
      }
    }
  }
  if ("stderr" in result) {
    result.stderr = "";
    result.stdout = "";
  }
  expect(result).toMatchSnapshot();
}

describe("findTests()", () => {
  const cwd = createFs({
    "readme.md": "",
    "package.json": "",
    "path": {
      "to": {
        "example1.js": "",
        "example2.test.ts": "",
        "example3.spec.js": "",
        "example.txt": "",
      },
      "example4.js.map": "",
      "example4.js": "",
      "example5.test.ts": "",
    },
  });
  const find = (options: FindTestOptions = {}) => {
    const results = findTests({ cwd, ...options });
    return [...results].sort();
  };
  test("can find all tests", () => {
    const results = find();
    expect(results).toEqual([
      "path/example4.js",
      "path/example5.test.ts",
      "path/to/example1.js",
      "path/to/example2.test.ts",
      "path/to/example3.spec.js",
    ]);
  });
  test("can find tests that match a directory", () => {
    const results = find({
      filters: ["path/to/"],
    });
    expect(results).toEqual(["path/to/example1.js", "path/to/example2.test.ts", "path/to/example3.spec.js"]);
  });
  test("can find tests that match a file", () => {
    const results = find({
      filters: ["example1.js", "example5.test.ts"],
    });
    expect(results).toEqual(["path/example5.test.ts", "path/to/example1.js"]);
  });
  test("can find tests that match a glob", () => {
    const results = find({
      filters: ["path/to/*.js", "*.spec.*"],
    });
    expect(results).toEqual(["path/to/example1.js", "path/to/example3.spec.js"]);
  });
  test("can find no tests", () => {
    const results = find({
      filters: ["path/to/nowhere/*"],
    });
    expect(results).toEqual([]);
  });
});

describe("bunSpawn()", () => {
  testSpawn(bunSpawn);
});

describe("nodeSpawn()", () => {
  testSpawn(nodeSpawn);
});

function testSpawn(spawn: typeof bunSpawn): void {
  test("can run a command", async () => {
    const { exitCode, stdout, stderr } = await spawn({
      cmd: "echo",
      args: ["hello world"],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("hello world\n");
    expect(stderr).toBe("");
  });
  test("can timeout a command", async () => {
    const { exitCode, stdout, stderr } = await spawn({
      cmd: "sleep",
      args: ["60"],
      timeout: 1,
    });
    expect(exitCode).toBe(null);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
}

type FsTree = {
  [path: string]: FsTree | string;
};

function createFs(tree: FsTree): string {
  let cwd = mkdtempSync(join(tmpdir(), "bun-internal-test-"));
  if (cwd.startsWith("/var/folders")) {
    cwd = join("/private", cwd); // HACK: macOS
  }
  const traverse = (tree: FsTree, path: string) => {
    for (const [name, content] of Object.entries(tree)) {
      const newPath = join(path, name);
      if (typeof content === "string") {
        writeFileSync(newPath, content);
      } else {
        mkdirSync(newPath);
        traverse(content, newPath);
      }
    }
  };
  traverse(tree, cwd);
  return cwd;
}
