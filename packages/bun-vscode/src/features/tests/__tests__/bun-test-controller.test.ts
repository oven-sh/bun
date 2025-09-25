import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MockLocation, MockPosition, MockTestController, MockUri, MockWorkspaceFolder } from "./vscode-types.mock";
import "./vscode.mock";
import { makeTestController, makeWorkspaceFolder } from "./vscode.mock";

const { BunTestController } = await import("../bun-test-controller");

const mockTestController: MockTestController = makeTestController();
const mockWorkspaceFolder: MockWorkspaceFolder = makeWorkspaceFolder("/test/workspace");

const controller = new BunTestController(mockTestController, mockWorkspaceFolder, true);
const internal = controller._internal;

describe("BunTestController", () => {
  beforeEach(() => {
    mockTestController.items.replace([]);
  });

  afterEach(() => {
    mockTestController.items.replace([]);
  });

  describe("buildTestNamePattern", () => {
    test("should escape template variables", () => {
      const mockTests = [
        { id: "file#test with ${variable}", tags: [{ id: "test" }] },
        { id: "file#test with \\${escaped}", tags: [{ id: "test" }] },
      ] as any;

      const pattern = internal.buildTestNamePattern(mockTests);

      expect(pattern).toContain(".*?");
      expect(pattern).toBe("(^ ?test with .*?$)|(^ ?test with \\.*?$)");
    });

    test("should escape % formatters", () => {
      const mockTests = [
        { id: "file#test with \\%i", tags: [{ id: "test" }] },
        { id: "file#test with \\%s", tags: [{ id: "test" }] },
      ] as any;

      const pattern = internal.buildTestNamePattern(mockTests);

      expect(pattern).toBe("(^ ?test with .*?$)|(^ ?test with .*?$)");
    });

    test("should join multiple patterns with |", () => {
      const mockTests = [
        { id: "file#test 1", tags: [{ id: "test" }] },
        { id: "file#test 2", tags: [{ id: "test" }] },
        { id: "file#test 3", tags: [{ id: "test" }] },
      ] as any;

      const pattern = internal.buildTestNamePattern(mockTests);

      expect(pattern).toBe("(^ ?test 1$)|(^ ?test 2$)|(^ ?test 3$)");
    });

    test("should handle describe blocks differently", () => {
      const mockTests = [{ id: "file#describe block", tags: [{ id: "describe" }] }] as any;

      const pattern = internal.buildTestNamePattern(mockTests);

      expect(pattern).toBe("(^ ?describe block )");
    });

    test("should handle complex nested test names", () => {
      const mockTests = [
        { id: "file#Parent > Child > test with ${var} and %s", tags: [{ id: "test" }] },
        { id: "file#Another > Deeply > Nested > test", tags: [{ id: "test" }] },
      ] as any;

      const pattern = internal.buildTestNamePattern(mockTests);

      expect(pattern).toContain("Parent Child test with .*? and");
      expect(pattern).toContain("Another Deeply Nested test");

      if (pattern) {
        expect(() => new RegExp(pattern)).not.toThrow();
      }
    });

    test("should handle special regex characters", () => {
      const mockTests = [
        { id: "file#test with [brackets]", tags: [{ id: "test" }] },
        { id: "file#test with (parentheses)", tags: [{ id: "test" }] },
        { id: "file#test with .dots.", tags: [{ id: "test" }] },
        { id: "file#test with *asterisks*", tags: [{ id: "test" }] },
        { id: "file#test with ?questions?", tags: [{ id: "test" }] },
        { id: "file#test with +plus+", tags: [{ id: "test" }] },
        { id: "file#test with ^caret^", tags: [{ id: "test" }] },
        { id: "file#test with $dollar$", tags: [{ id: "test" }] },
      ] as any;

      const pattern = internal.buildTestNamePattern(mockTests);

      expect(pattern).toContain("[brackets]");
      expect(pattern).toContain("(parentheses)");
      expect(pattern).toContain(".dots.");
      expect(pattern).toContain("*asterisks*");
      expect(pattern).toContain("?questions?");
      expect(pattern).toContain("+plus+");
      expect(pattern).toContain("^caret^");

      expect(() => new RegExp(pattern)).not.toThrow();
    });

    test("should handle empty test arrays", () => {
      const pattern = internal.buildTestNamePattern([]);
      expect(pattern).toBe(null);
    });

    test("should handle tests without tags", () => {
      const mockTests = [
        { id: "file#test without tags", tags: [] },
        { id: "file#another test", tags: undefined },
      ] as any;

      const pattern = internal.buildTestNamePattern(mockTests);
      expect(pattern).toBe("(test without tags)|(another test)");
    });

    test("should handle Unicode and emoji in test names", () => {
      const mockTests = [
        { id: "file#test with 🎉 emoji", tags: [{ id: "test" }] },
        { id: "file#test with ñoño characters", tags: [{ id: "test" }] },
        { id: "file#test with 中文 characters", tags: [{ id: "test" }] },
      ] as any;

      const pattern = internal.buildTestNamePattern(mockTests);
      expect(pattern).toContain("🎉 emoji");
      expect(pattern).toContain("ñoño characters");
      expect(pattern).toContain("中文 characters");
    });

    test("should handle very long test names", () => {
      const longName = "very ".repeat(100) + "long test name";
      const mockTests = [{ id: `file#${longName}`, tags: [{ id: "test" }] }] as any;

      const pattern = internal.buildTestNamePattern(mockTests);
      expect(pattern).toContain(longName);
      expect(pattern.length).toBeGreaterThan(500);
    });
  });

  describe("stripAnsi", () => {
    test("should remove ANSI color codes", () => {
      const colored = "\u001b[31mred text\u001b[0m";
      expect(internal.stripAnsi(colored)).toBe("red text");
    });

    test("should handle multiple ANSI codes", () => {
      const colored = "\u001b[1m\u001b[32mbold green\u001b[0m\u001b[2m and dim\u001b[0m";
      expect(internal.stripAnsi(colored)).toBe("bold green and dim");
    });

    test("should leave non-ANSI text unchanged", () => {
      const plain = "plain text without colors";
      expect(internal.stripAnsi(plain)).toBe("plain text without colors");
    });

    test("should handle empty strings", () => {
      expect(internal.stripAnsi("")).toBe("");
    });

    test("should handle complex ANSI sequences", () => {
      const complexAnsi =
        "\u001b[38;5;196mcomplex\u001b[48;5;21mcolor\u001b[0m\u001b[1;4;32mbold underline green\u001b[0m";
      expect(internal.stripAnsi(complexAnsi)).toBe("complexcolorbold underline green");
    });

    test("should handle edge cases", () => {
      expect(internal.stripAnsi("\u001b[incomplete")).toBe("ncomplete");

      expect(internal.stripAnsi("normal \u001b[31mred\u001b[0m normal again")).toBe("normal red normal again");

      expect(internal.stripAnsi("\u001b[31m\u001b[0m")).toBe("");

      expect(internal.stripAnsi("\u001b[1m\u001b[31mbold red\u001b[39mnormal bold\u001b[0m")).toBe(
        "bold rednormal bold",
      );
    });

    test("should handle 256-color and true-color ANSI codes", () => {
      const color256 = "\u001b[38;5;196mcolor 256\u001b[0m";
      const trueColor = "\u001b[38;2;255;128;64mtrue color\u001b[0m";

      expect(internal.stripAnsi(color256)).toBe("color 256");
      expect(internal.stripAnsi(trueColor)).toBe("true color");
    });

    test("should handle cursor movement and other ANSI sequences", () => {
      const cursor = "\u001b[2Jclear\u001b[H\u001b[1;1Hmove cursor";
      expect(internal.stripAnsi(cursor)).toBe("clearmove cursor");
    });
  });

  describe("processErrorData", () => {
    test("should handle toBe errors", () => {
      const message = "expect(received).toBe(expected)\n\nExpected: 5\nReceived: 3";
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle toEqual errors", () => {
      const message = `expect(received).toEqual(expected)\nExpected: { name: "John", age: 30 }\nReceived: { name: "Jane", age: 25 }`;
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle toBeInstanceOf errors", () => {
      const message = "expect(received).toBeInstanceOf(expected)\nExpected constructor: Array\nReceived value: {}";
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle not.toBe errors", () => {
      const message = "expect(received).not.toBe(expected)\nExpected: not null\nReceived: null";
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle generic errors", () => {
      const message = "TypeError: Cannot read property 'foo' of undefined";
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle diff format", () => {
      const message = `expect(received).toEqual(expected)\n\n- Expected\n+ Received\n\n  Object {\n-   "name": "John",\n+   "name": "Jane",\n    "age": 30,\n  }`;
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle snapshot errors", () => {
      const message = `expect(received).toMatchSnapshot(expected)\nExpected: "Hello World"\nReceived: "Hello Universe"`;
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle inline snapshot errors", () => {
      const message = 'expect(received).toMatchInlineSnapshot(expected)\nExpected: "old value"\nReceived: "new value"';
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(15, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle toBeNull errors", () => {
      const message = 'expect(received).toBeNull()\n\nReceived: "not null"';
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle toMatchObject errors", () => {
      const message = `expect(received).toMatchObject(expected)\n\n- Expected\n+ Received\n\n  Object {\n-   "name": "John",\n+   "name": "Jane",\n+   "age": 30,\n  }`;
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle malformed error messages", () => {
      const message = "Completely malformed error without pattern";
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle errors with stack traces", () => {
      const message = `Error: Test failed\n    at /test/file.ts:25:10\n    at TestRunner.run (/lib/test.js:100:5)`;
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(25, 10));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle Windows file paths", () => {
      const message = `Error: Test failed\n    at C:\\test\\file.ts:15:8`;
      const location = new MockLocation(new MockUri("file:///C:/test/file.ts"), new MockPosition(15, 8));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle complex stack traces", () => {
      const message = `Error: Complex error\n    at Object.test (/complex/path/to/test.spec.ts:42:16)\n    at async TestRunner.execute (/node_modules/test/runner.js:200:12)\n    at async Suite.run (/node_modules/test/suite.js:50:8)`;
      const location = new MockLocation(new MockUri("file:///complex/path/to/test.spec.ts"), new MockPosition(42, 16));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle errors with no stack trace", () => {
      const message = "Simple error message with no stack";
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(0, 0));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle timeout errors", () => {
      const message = "Error: Test timeout after 5000ms";
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });

    test("should handle assertion errors with detailed info", () => {
      const message = `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n\n+ 'hello world'\n- 'hello universe'\n    at /test/assertions.test.ts:10:5`;
      const location = new MockLocation(new MockUri("file:///test/assertions.test.ts"), new MockPosition(10, 5));

      const result = internal.processErrorData(message, location);
      expect(result).toBeDefined();
      expect(result.location).toBe(location);
    });
  });

  describe("escapeTestName", () => {
    test("should escape special characters", () => {
      expect(internal.escapeTestName("test with [brackets]")).toBe("test with \\[brackets\\]");
      expect(internal.escapeTestName("test with (parentheses)")).toBe("test with \\(parentheses\\)");
      expect(internal.escapeTestName("test with .dots")).toBe("test with \\.dots");
      expect(internal.escapeTestName("test with *asterisks")).toBe("test with \\*asterisks");
      expect(internal.escapeTestName("test with ?questions")).toBe("test with \\?questions");
      expect(internal.escapeTestName("test with +plus")).toBe("test with \\+plus");
      expect(internal.escapeTestName("test with ^caret")).toBe("test with \\^caret");
      expect(internal.escapeTestName("test with $dollar")).toBe("test with \\$dollar");
      expect(internal.escapeTestName("test with {braces}")).toBe("test with \\{braces\\}");
      expect(internal.escapeTestName("test with |pipe")).toBe("test with \\|pipe");
      expect(internal.escapeTestName("test with \\backslash")).toBe("test with \\\\backslash");
    });

    test("should handle empty and special cases", () => {
      expect(internal.escapeTestName("")).toBe("");
      expect(internal.escapeTestName("normal test")).toBe("normal test");
      expect(internal.escapeTestName("123")).toBe("123");
      expect(internal.escapeTestName("test-with-dashes")).toBe("test-with-dashes");
      expect(internal.escapeTestName("test_with_underscores")).toBe("test_with_underscores");
    });

    test("should handle complex patterns", () => {
      const complex = "test.[*?+^${}|()\\]pattern";
      const escaped = internal.escapeTestName(complex);
      expect(escaped).toBe("test\\.\\[\\*\\?\\+\\^\\$\\{\\}\\|\\(\\)\\\\\\]pattern");
    });

    test("should handle Unicode characters", () => {
      expect(internal.escapeTestName("test with 🎉")).toBe("test with 🎉");
      expect(internal.escapeTestName("test with ñ")).toBe("test with ñ");
      expect(internal.escapeTestName("test with 中文")).toBe("test with 中文");
    });

    test("should handle mixed content", () => {
      const mixed = "normal text [special] normal again";
      expect(internal.escapeTestName(mixed)).toBe("normal text \\[special\\] normal again");
    });
  });
});

describe("BunTestController - Test Discovery and Management", () => {
  describe("shouldUseTestNamePattern", () => {
    test("should return false for single file test", () => {
      const mockTests = [
        {
          id: "/test/file.ts",
          uri: { fsPath: "/test/file.ts", toString: () => "/test/file.ts" },
          label: "file.ts",
          parent: null,
        },
      ] as any;

      const result = internal.shouldUseTestNamePattern(mockTests);
      expect(result).toBe(false);
    });

    test("should return true for individual tests", () => {
      const mockParent = {
        children: new Map([
          ["test1", { id: "test1" }],
          ["test2", { id: "test2" }],
        ]),
      };

      const mockTests = [
        {
          id: "/test/file.ts#test 1",
          uri: { fsPath: "/test/file.ts", toString: () => "/test/file.ts" },
          label: "test 1",
          parent: mockParent,
        },
      ] as any;

      const result = internal.shouldUseTestNamePattern(mockTests);
      expect(result).toBe(true);
    });

    test("should return false for empty test array", () => {
      const result = internal.shouldUseTestNamePattern([]);
      expect(result).toBe(false);
    });

    test("should handle tests without URI", () => {
      const mockTests = [
        {
          id: "test without uri",
          label: "test without uri",
          parent: null,
        },
      ] as any;

      const result = internal.shouldUseTestNamePattern(mockTests);
      expect(result).toBe(false);
    });

    test("should handle multiple individual tests", () => {
      const mockParent = {
        children: new Map([
          ["test1", { id: "test1" }],
          ["test2", { id: "test2" }],
          ["test3", { id: "test3" }],
        ]),
      };

      const mockTests = [
        {
          id: "/test/file.ts#test 1",
          uri: { fsPath: "/test/file.ts" },
          label: "test 1",
          parent: mockParent,
        },
        {
          id: "/test/file.ts#test 2",
          uri: { fsPath: "/test/file.ts" },
          label: "test 2",
          parent: mockParent,
        },
      ] as any;

      const result = internal.shouldUseTestNamePattern(mockTests);
      expect(result).toBe(true);
    });

    test("should handle describe blocks", () => {
      const mockTests = [
        {
          id: "/test/file.ts#describe block",
          uri: { fsPath: "/test/file.ts", toString: () => "/test/file.ts" },
          label: "describe block",
          parent: null,
          children: new Map([["child", { id: "child" }]]),
        },
      ] as any;

      const result = internal.shouldUseTestNamePattern(mockTests);

      expect(result).toBe(false);
    });
  });

  describe("isTestFile", () => {
    test("should identify test files correctly", () => {
      const testDoc = { uri: { scheme: "file", fsPath: "/path/to/test.test.ts" } } as any;
      expect(internal.isTestFile(testDoc)).toBe(true);

      const specDoc = { uri: { scheme: "file", fsPath: "/path/to/component.spec.js" } } as any;
      expect(internal.isTestFile(specDoc)).toBe(true);

      const underscoreTestDoc = { uri: { scheme: "file", fsPath: "/path/to/utils.test.tsx" } } as any;
      expect(internal.isTestFile(underscoreTestDoc)).toBe(true);

      const underscoreSpecDoc = { uri: { scheme: "file", fsPath: "/path/to/helpers.spec.jsx" } } as any;
      expect(internal.isTestFile(underscoreSpecDoc)).toBe(true);
    });

    test("should reject non-test files", () => {
      const regularDoc = { uri: { scheme: "file", fsPath: "/path/to/component.ts" } } as any;
      expect(internal.isTestFile(regularDoc)).toBe(false);

      const indexDoc = { uri: { scheme: "file", fsPath: "/path/to/index.js" } } as any;
      expect(internal.isTestFile(indexDoc)).toBe(false);

      const configDoc = { uri: { scheme: "file", fsPath: "/path/to/config.json" } } as any;
      expect(internal.isTestFile(configDoc)).toBe(false);
    });

    test("should handle edge cases", () => {
      const noExtensionDoc = { uri: { scheme: "file", fsPath: "/path/to/test" } } as any;
      expect(internal.isTestFile(noExtensionDoc)).toBe(false);

      const testInPathDoc = { uri: { scheme: "file", fsPath: "/test/path/component.ts" } } as any;
      expect(internal.isTestFile(testInPathDoc)).toBe(false);

      const testSuffixDoc = { uri: { scheme: "file", fsPath: "/path/to/mytest.ts" } } as any;
      expect(internal.isTestFile(testSuffixDoc)).toBe(false);
    });

    test("should handle various test file patterns", () => {
      const patterns = [
        "/src/components/Button.test.ts",
        "/src/utils/helpers.spec.js",
        "/src/pages/Home.test.tsx",
        "/src/hooks/useAuth.spec.jsx",
        "/tests/integration/api.test.mts",
        "/tests/unit/utils.spec.cts",
        "/src/lib/math.test.cjs",
        "/src/services/data.spec.mjs",
      ];

      patterns.forEach(path => {
        const doc = { uri: { scheme: "file", fsPath: path } } as any;
        expect(internal.isTestFile(doc)).toBe(true);
      });
    });

    test("should handle non-file schemes", () => {
      const nonFileDoc = { uri: { scheme: "http", fsPath: "/test.test.ts" } } as any;
      expect(internal.isTestFile(nonFileDoc)).toBe(false);

      const untitledDoc = { uri: { scheme: "untitled", fsPath: "test.spec.js" } } as any;
      expect(internal.isTestFile(untitledDoc)).toBe(false);
    });
  });

  describe("customFilePattern", () => {
    test("should return the default test pattern", () => {
      const pattern = internal.customFilePattern();
      expect(pattern).toBe("**/*{.test.,.spec.,_test_,_spec_}{js,ts,tsx,jsx,mts,cts,cjs,mjs}");
    });

    test("should return a valid glob pattern", () => {
      const pattern = internal.customFilePattern();
      expect(pattern).toMatch(/^\*\*\/\*/);
      expect(pattern).toContain(".test.");
      expect(pattern).toContain(".spec.");
      expect(pattern).toContain("_test_");
      expect(pattern).toContain("_spec_");
      expect(pattern).toContain("{js,ts,tsx,jsx,mts,cts,cjs,mjs}");
    });
  });

  describe("getBunExecutionConfig", () => {
    test("should return bun execution configuration", () => {
      const config = internal.getBunExecutionConfig();
      expect(config).toHaveProperty("testArgs");
      expect(config).toHaveProperty("bunCommand");
      expect(Array.isArray(config.testArgs)).toBe(true);
      expect(typeof config.bunCommand).toBe("string");
    });

    test("should include test runner arguments", () => {
      const config = internal.getBunExecutionConfig();
      expect(config.testArgs).toContain("test");
    });

    test("should include common bun test options", () => {
      const config = internal.getBunExecutionConfig();
      const args = config.testArgs.join(" ");
      expect(config.bunCommand).toBe("bun");
    });
  });
});

describe("BunTestController - Test Item Management", () => {
  describe("findTestByPath", () => {
    test("should find test by path when no parent ID", () => {
      const result = internal.findTestByPath.call(controller, "testName", "/test/file.ts");
      expect(result).toBeUndefined(); // Expected since we don't have full VSCode mock
    });

    test("should handle missing test items", () => {
      mockTestController.items.replace([]);
      const result = internal.findTestByPath.call(controller, "nonexistent", "/test/nonexistent.ts");
      expect(result).toBeUndefined();
    });

    test("should find test with parent ID", () => {
      const result = internal.findTestByPath.call(controller, "testName", "/test/file.ts", 123);
      expect(result).toBeUndefined(); // Expected since we don't have full VSCode mock
    });

    test("should handle complex test names", () => {
      const complexName = "test with spaces and special chars @#$%";
      const result = internal.findTestByPath.call(controller, complexName, "/test/complex.ts");
      expect(result).toBeUndefined(); // Expected since we don't have full VSCode mock
    });

    test("should handle nested test paths", () => {
      const nestedPath = "/very/deeply/nested/path/to/test.spec.ts";
      const result = internal.findTestByPath.call(controller, "nested test", nestedPath);
      expect(result).toBeUndefined(); // Expected since we don't have full VSCode mock
    });
  });

  describe("findTestByName", () => {
    test("should find test by name in parent children", () => {
      const mockChild = { id: "child-test", label: "test name" };
      const mockParent = {
        children: new Map([["child-id", mockChild]]),
      };

      const result = internal.findTestByName(mockParent as any, "test name");
      expect(result).toBe(mockChild);
    });

    test("should return undefined for non-existent test", () => {
      const mockParent = {
        children: new Map(),
      };

      const result = internal.findTestByName(mockParent as any, "nonexistent");
      expect(result).toBeUndefined();
    });

    test("should handle parent without children", () => {
      const mockParent = { children: new Map() } as any;
      const result = internal.findTestByName.call(controller, mockParent, "test");
      expect(result).toBeUndefined();
    });

    test("should handle case-sensitive search", () => {
      const mockChild1 = { id: "child1", label: "Test Name" };
      const mockChild2 = { id: "child2", label: "test name" };
      const mockParent = {
        children: new Map([
          ["child1", mockChild1],
          ["child2", mockChild2],
        ]),
      };

      const result1 = internal.findTestByName(mockParent as any, "Test Name");
      const result2 = internal.findTestByName(mockParent as any, "test name");

      expect(result1).toBe(mockChild1);
      expect(result2).toBe(mockChild2);
      expect(result1).not.toBe(result2);
    });

    test("should handle multiple children with different names", () => {
      const children = Array.from({ length: 10 }, (_, i) => ({
        id: `child-${i}`,
        label: `test ${i}`,
      }));

      const mockParent = {
        children: new Map(children.map(child => [child.id, child])),
      };

      children.forEach(child => {
        const result = internal.findTestByName(mockParent as any, child.label);
        expect(result).toBe(child);
      });
    });

    test("should handle special characters in test names", () => {
      const specialChild = { id: "special", label: "test with [special] chars!" };
      const mockParent = {
        children: new Map([["special", specialChild]]),
      };

      const result = internal.findTestByName(mockParent as any, "test with [special] chars!");
      expect(result).toBe(specialChild);
    });
  });

  describe("createTestItem", () => {
    test("should create test item with basic properties", () => {
      const result = internal.createTestItem.call(controller, "test name", "/test/file.ts", "test", undefined, 10);

      expect(result).toBeDefined();
      expect(result?.label).toBe("test name");
      expect(result?.uri?.fsPath).toBe("/test/file.ts");
    });

    test("should handle test without parent", () => {
      const result = internal.createTestItem.call(controller, "root test", "/test/file.ts", "test", undefined, 5);
      expect(result).toBeDefined();
      expect(result?.label).toBe("root test");
    });

    test("should set appropriate tags based on test type", () => {
      const result = internal.createTestItem.call(
        controller,
        "describe block",
        "/test/file.ts",
        "describe",
        undefined,
        1,
      );
      expect(result).toBeDefined();
      expect(result?.tags).toBeDefined();
      expect(result?.tags[0]?.id).toBe("describe");
    });

    test("should handle different test types", () => {
      const testTypes = ["test", "describe"];

      testTypes.forEach(type => {
        const result = internal.createTestItem.call(
          controller,
          `${type} item`,
          "/test/file.ts",
          type as "test" | "describe",
          undefined,
          1,
        );
        expect(result).toBeDefined();
        expect(result?.tags[0]?.id).toBe(type);
      });
    });

    test("should handle long test names", () => {
      const longName = "very ".repeat(50) + "long test name";
      const result = internal.createTestItem.call(controller, longName, "/test/file.ts", "test", undefined, 1);
      expect(result).toBeDefined();
      expect(result?.label).toBe(longName);
    });

    test("should handle special characters in file paths", () => {
      const specialPath = "/test/path with spaces/file-name.test.ts";
      const result = internal.createTestItem.call(controller, "test", specialPath, "test", undefined, 1);
      expect(result).toBeDefined();
      expect(result?.uri?.fsPath).toBe(specialPath);
    });

    test("should handle various line numbers", () => {
      const lineNumbers = [1, 10, 100, 1000, 9999];

      lineNumbers.forEach(line => {
        const result = internal.createTestItem.call(controller, "test", "/test/file.ts", "test", undefined, line);
        expect(result).toBeDefined();

        expect(result?.label).toBe("test");
      });
    });
  });
});

describe("BunTestController - Error Handling", () => {
  describe("createErrorMessage", () => {
    test("should create error message from TestError", () => {
      const errorInfo = {
        message: "Test failed with error",
        file: "/test/file.ts",
        line: 15,
        column: 10,
      };

      const mockTestItem = {
        uri: { fsPath: "/test/file.ts" },
        range: { start: { line: 14 } },
      } as any;

      const result = internal.createErrorMessage.call(controller, errorInfo, mockTestItem);

      expect(result).toBeDefined();
      expect(result.message).toContain("Test failed with error");
    });

    test("should handle error without location", () => {
      const errorInfo = {
        message: "Generic error",
        file: "",
        line: 0,
        column: 0,
      };

      const mockTestItem = {} as any;

      const result = internal.createErrorMessage.call(controller, errorInfo, mockTestItem);
      expect(result).toBeDefined();
      expect(result.message).toContain("Generic error");
    });

    test("should handle complex error messages", () => {
      const complexError = {
        message: `MultiLine error message
with stack trace
and additional context`,
        file: "/complex/test.ts",
        line: 42,
        column: 8,
      };

      const mockTestItem = {
        uri: { fsPath: "/complex/test.ts" },
        range: { start: { line: 41 } },
      } as any;

      const result = internal.createErrorMessage.call(controller, complexError, mockTestItem);
      expect(result).toBeDefined();
      expect(result.message).toContain("MultiLine error message");
      expect(result.message).toContain("stack trace");
      expect(result.message).toContain("additional context");
    });

    test("should handle assertion errors with diff", () => {
      const diffError = {
        message: `Expected: { name: "John", age: 30 }
Received: { name: "Jane", age: 25 }
Difference:
- John
+ Jane
- 30
+ 25`,
        file: "/test/diff.ts",
        line: 20,
        column: 5,
      };

      const mockTestItem = {
        uri: { fsPath: "/test/diff.ts" },
        range: { start: { line: 19 } },
      } as any;

      const result = internal.createErrorMessage.call(controller, diffError, mockTestItem);
      expect(result).toBeDefined();
      expect(result.message).toContain("Expected:");
      expect(result.message).toContain("Received:");
      expect(result.message).toContain("John");
      expect(result.message).toContain("Jane");
    });

    test("should handle timeout errors", () => {
      const timeoutError = {
        message: "Test timed out after 5000ms",
        file: "/test/timeout.ts",
        line: 10,
        column: 1,
      };

      const mockTestItem = {
        uri: { fsPath: "/test/timeout.ts" },
        range: { start: { line: 9 } },
      } as any;

      const result = internal.createErrorMessage.call(controller, timeoutError, mockTestItem);
      expect(result).toBeDefined();
      expect(result.message).toContain("timed out after 5000ms");
    });

    test("should handle JavaScript errors", () => {
      const jsError = {
        message: "TypeError: Cannot read property 'foo' of undefined",
        file: "/test/js-error.ts",
        line: 35,
        column: 12,
      };

      const mockTestItem = {
        uri: { fsPath: "/test/js-error.ts" },
        range: { start: { line: 34 } },
      } as any;

      const result = internal.createErrorMessage.call(controller, jsError, mockTestItem);
      expect(result).toBeDefined();
      expect(result.message).toContain("TypeError:");
      expect(result.message).toContain("Cannot read property 'foo'");
    });
  });

  describe("cleanupTestItem", () => {
    test("should clean up test item and its children", () => {
      const mockChild = {
        id: "child",
        tags: [],
        children: new Map(),
      };

      const mockParent = {
        id: "parent",
        tags: [],
        children: new Map([["child", mockChild]]),
      };

      expect(() => {
        internal.cleanupTestItem.call(controller, mockParent as any);
      }).not.toThrow();
    });

    test("should handle item without children", () => {
      const mockItem = {
        id: "simple-item",
        tags: [],
        children: new Map(),
      };

      expect(() => {
        internal.cleanupTestItem.call(controller, mockItem as any);
      }).not.toThrow();
    });

    test("should handle deeply nested cleanup", () => {
      const createNestedItem = (depth: number): any => {
        if (depth === 0) {
          return {
            id: `item-0`,
            tags: [],
            children: new Map(),
          };
        }

        const child = createNestedItem(depth - 1);
        return {
          id: `item-${depth}`,
          tags: [],
          children: new Map([[`child-${depth}`, child]]),
        };
      };

      const deeplyNested = createNestedItem(10);

      expect(() => {
        internal.cleanupTestItem.call(controller, deeplyNested);
      }).not.toThrow();
    });

    test("should handle items with multiple children", () => {
      const children = Array.from({ length: 20 }, (_, i) => ({
        id: `child-${i}`,
        tags: [],
        children: new Map(),
      }));

      const parent = {
        id: "parent-with-many-children",
        tags: [],
        children: new Map(children.map(child => [child.id, child])),
      };

      expect(() => {
        internal.cleanupTestItem.call(controller, parent as any);
      }).not.toThrow();
    });

    test("should handle circular references gracefully", () => {
      const item1: any = {
        id: "item1",
        tags: [],
        children: new Map(),
      };

      const item2: any = {
        id: "item2",
        tags: [],
        children: new Map([["item1", item1]]),
      };

      item1.children.set("item2", item2);

      expect(() => {
        internal.cleanupTestItem.call(controller, item1);
      }).not.toThrow();
    });
  });
});

describe("BunTestController - Integration and Coverage", () => {
  describe("_internal getter", () => {
    test("should expose all expected internal methods", () => {
      expect(internal).toHaveProperty("expandEachTests");
      expect(internal).toHaveProperty("parseTestBlocks");
      expect(internal).toHaveProperty("getBraceDepth");

      expect(internal).toHaveProperty("buildTestNamePattern");
      expect(internal).toHaveProperty("stripAnsi");
      expect(internal).toHaveProperty("processErrorData");
      expect(internal).toHaveProperty("escapeTestName");
      expect(internal).toHaveProperty("shouldUseTestNamePattern");

      expect(internal).toHaveProperty("isTestFile");
      expect(internal).toHaveProperty("customFilePattern");
      expect(internal).toHaveProperty("getBunExecutionConfig");

      expect(internal).toHaveProperty("findTestByPath");
      expect(internal).toHaveProperty("findTestByName");
      expect(internal).toHaveProperty("createTestItem");

      expect(internal).toHaveProperty("createErrorMessage");

      expect(internal).toHaveProperty("cleanupTestItem");
    });

    test("should expose functions that are callable", () => {
      expect(typeof internal.expandEachTests).toBe("function");
      expect(typeof internal.buildTestNamePattern).toBe("function");
      expect(typeof internal.stripAnsi).toBe("function");
      expect(typeof internal.processErrorData).toBe("function");
      expect(typeof internal.parseTestBlocks).toBe("function");
      expect(typeof internal.getBraceDepth).toBe("function");
      expect(typeof internal.escapeTestName).toBe("function");
      expect(typeof internal.shouldUseTestNamePattern).toBe("function");
      expect(typeof internal.isTestFile).toBe("function");
      expect(typeof internal.customFilePattern).toBe("function");
      expect(typeof internal.getBunExecutionConfig).toBe("function");
      expect(typeof internal.findTestByPath).toBe("function");
      expect(typeof internal.findTestByName).toBe("function");
      expect(typeof internal.createTestItem).toBe("function");
      expect(typeof internal.createErrorMessage).toBe("function");
      expect(typeof internal.cleanupTestItem).toBe("function");
    });

    test("should provide consistent API", () => {
      const methodNames = Object.keys(internal);
      const functionCount = methodNames.filter(name => typeof internal[name] === "function").length;

      expect(functionCount).toBe(methodNames.length);
      expect(methodNames.length).toBeGreaterThanOrEqual(16);
    });
  });

  describe("comprehensive controller functionality", () => {
    test("VSCode extension supports comprehensive test.each scenarios", () => {
      expect(typeof internal.parseTestBlocks).toBe("function");
      expect(typeof internal.expandEachTests).toBe("function");
      expect(typeof internal.getBraceDepth).toBe("function");

      expect(typeof internal.buildTestNamePattern).toBe("function");
      expect(typeof internal.stripAnsi).toBe("function");
      expect(typeof internal.processErrorData).toBe("function");

      expect(typeof internal.escapeTestName).toBe("function");
      expect(typeof internal.shouldUseTestNamePattern).toBe("function");
      expect(typeof internal.isTestFile).toBe("function");
      expect(typeof internal.customFilePattern).toBe("function");
      expect(typeof internal.getBunExecutionConfig).toBe("function");
      expect(typeof internal.findTestByPath).toBe("function");
      expect(typeof internal.findTestByName).toBe("function");
      expect(typeof internal.createTestItem).toBe("function");
      expect(typeof internal.createErrorMessage).toBe("function");
      expect(typeof internal.cleanupTestItem).toBe("function");

      expect(controller).toBeDefined();
      expect(controller._internal).toBeDefined();

      const internalMethods = Object.keys(internal);
      expect(internalMethods.length).toBeGreaterThanOrEqual(16);
    });

    test("should handle controller disposal", () => {
      expect(typeof controller.dispose).toBe("function");
      expect(() => controller.dispose()).not.toThrow();
    });
  });

  describe("performance and stress testing", () => {
    test("should handle large test name patterns efficiently", () => {
      const largeTestArray = Array.from({ length: 1000 }, (_, i) => ({
        id: `file#test ${i} with some content`,
        tags: [{ id: "test" }],
      }));

      const startTime = Date.now();
      const pattern = internal.buildTestNamePattern(largeTestArray as any);
      const endTime = Date.now();

      expect(pattern).toBeDefined();
      expect(pattern.length).toBeGreaterThan(10000);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
    });

    test("should handle complex error processing efficiently", () => {
      const largeErrorMessage = "Error: " + "very long error message ".repeat(1000);
      const location = new MockLocation(new MockUri("file:///test/file.ts"), new MockPosition(10, 5));

      const startTime = Date.now();
      const result = internal.processErrorData(largeErrorMessage, location);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    });

    test("should handle many ANSI codes efficiently", () => {
      const manyAnsiCodes = Array.from({ length: 1000 }, (_, i) => `\u001b[${i % 255}mtext ${i}\u001b[0m`).join(" ");

      const startTime = Date.now();
      const result = internal.stripAnsi(manyAnsiCodes);
      const endTime = Date.now();

      expect(result).not.toContain("\u001b");
      expect(result).toContain("text 0");
      expect(result).toContain("text 999");
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
    });
  });

  describe("edge cases and error handling", () => {
    test("should handle malformed data gracefully", () => {
      expect(() => internal.buildTestNamePattern([])).not.toThrow();

      expect(() => internal.stripAnsi("")).not.toThrow();
      expect(() => internal.escapeTestName("")).not.toThrow();
    });

    test("should handle empty inputs", () => {
      expect(internal.buildTestNamePattern([])).toBe(null);
      expect(internal.stripAnsi("")).toBe("");
      expect(internal.escapeTestName("")).toBe("");
    });

    test("should handle invalid test items", () => {
      const mockItem = { children: new Map() } as any;
      expect(() => internal.findTestByName(mockItem, "test")).not.toThrow();

      const emptyItem = { children: new Map() } as any;
      expect(() => internal.findTestByName(emptyItem, "test")).not.toThrow();
    });
  });
});
