import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseString as xmlParseString } from "xml2js";
import type { BunFileResult, BunTestResult, ProcessInfo, TestNode } from "./types";

const DEFAULT_TEST_PATTERN = "**/*{.test.,.spec.,_test_,_spec_}{js,ts,tsx,jsx,mts,cts,cjs,mjs}";

export class BunTestController implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private activeProcesses: Set<ProcessInfo> = new Set();

  constructor(
    private readonly testController: vscode.TestController,
    private readonly workspaceFolder: vscode.WorkspaceFolder,
  ) {
    this.setupTestController();
    this.setupWatchers();
    this.setupOpenDocumentListener();
    this.discoverInitialTests();
  }

  private setupTestController(): void {
    this.testController.resolveHandler = async testItem => {
      await this.staticDiscoverTests(testItem);
    };

    this.testController.createRunProfile(
      "Run Test",
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runHandler(request, token, false),
      true,
    );

    this.testController.createRunProfile(
      "Debug",
      vscode.TestRunProfileKind.Debug,
      (request, token) => this.runHandler(request, token, true),
      true,
    );
  }

  private setupOpenDocumentListener(): void {
    const openEditors = vscode.window.visibleTextEditors;
    for (const editor of openEditors) {
      this.handleOpenDocument(editor.document);
    }

    vscode.workspace.onDidOpenTextDocument(
      document => {
        this.handleOpenDocument(document);
      },
      null,
      this.disposables,
    );
  }

  private handleOpenDocument(document: vscode.TextDocument): void {
    if (this.isTestFile(document) && !this.testController.items.get(document.uri.toString())) {
      this.staticDiscoverTests(false, document.uri.fsPath);
    }
  }

  private isTestFile(document: vscode.TextDocument): boolean {
    return document?.uri?.scheme === "file" && /\.(test|spec)\.(js|jsx|ts|tsx|cjs|mts)$/.test(document.uri.fsPath);
  }

  private async discoverInitialTests(): Promise<void> {
    try {
      const tests = await this.findTestFiles();
      this.createFileTestItems(tests);
    } catch (error) {
      // Silent error handling
    }
  }

  private async findTestFiles(): Promise<vscode.Uri[]> {
    return await this.findTestFilesWithGitignore();
  }

  private customFilePattern(): string {
    return vscode.workspace.getConfiguration("bun.test").get("filePattern", DEFAULT_TEST_PATTERN);
  }

  private async findTestFilesWithGitignore(): Promise<vscode.Uri[]> {
    const ignoreGlobs = await this.buildIgnoreGlobs();
    const tests = await vscode.workspace.findFiles(this.customFilePattern(), "node_modules");

    return tests.filter(test => {
      const normalizedTestPath = test.fsPath.replace(/\\/g, "/");
      return !ignoreGlobs.some(glob => {
        const normalizedGlob = glob.replace(/\\/g, "/").replace(/^\.\//, "");
        return normalizedTestPath.includes(normalizedGlob);
      });
    });
  }

  private async buildIgnoreGlobs(): Promise<string[]> {
    const ignores = await vscode.workspace.findFiles("**/.gitignore", "**/node_modules/**");
    const ignoreGlobs = ["**/node_modules/**"];

    for (const ignore of ignores) {
      try {
        const content = await fs.readFile(ignore.fsPath, "utf8");
        const lines = content
          .split("\n")
          .map(line => line.trim())
          .filter(line => line && !line.startsWith("#"));

        const cwd = path.relative(this.workspaceFolder.uri.fsPath, path.dirname(ignore.fsPath));

        for (const line of lines) {
          if (!cwd || cwd === "" || cwd === ".") {
            ignoreGlobs.push(line.trim());
          } else {
            ignoreGlobs.push(path.join(cwd.trim(), line.trim()));
          }
        }
      } catch (err) {
        // Silent error handling
      }
    }

    return ignoreGlobs;
  }

  private createFileTestItems(files: vscode.Uri[]): void {
    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      let fileTestItem = this.testController.items.get(file.toString());
      if (!fileTestItem) {
        fileTestItem = this.testController.createTestItem(
          file.toString(),
          path.relative(this.workspaceFolder.uri.fsPath, file.fsPath) || file.fsPath,
          file,
        );
        fileTestItem.children.replace([]);
        fileTestItem.canResolveChildren = true;
        this.testController.items.add(fileTestItem);
      }
    }
  }

  private async setupWatchers(): Promise<void> {
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, this.customFilePattern()),
    );

    const refreshTestsForFile = (uri: vscode.Uri) => {
      if (uri.toString().includes("node_modules")) return;

      const existing = this.testController.items.get(uri.toString());
      if (existing) {
        existing.children.replace([]);
        this.staticDiscoverTests(existing);
      } else {
        this.staticDiscoverTests(false, uri.fsPath);
      }
    };

    fileWatcher.onDidChange(refreshTestsForFile);
    fileWatcher.onDidCreate(refreshTestsForFile);
    fileWatcher.onDidDelete(uri => {
      const existing = this.testController.items.get(uri.toString());
      if (existing) {
        this.testController.items.delete(existing.id);
      }
    });

    this.disposables.push(fileWatcher);
  }

  private getBunExecutionConfig() {
    const customFlag = vscode.workspace.getConfiguration("bun.test").get("customFlag", "").trim();
    const customScriptSetting = vscode.workspace.getConfiguration("bun.test").get("customScript", "bun test").trim();
    const customScript = customScriptSetting.length ? customScriptSetting : "bun test";

    const [cmd, ...args] = customScript.split(/\s+/);

    let bunCommand = "bun";
    if (cmd === "bun") {
      const bunRuntime = vscode.workspace.getConfiguration("bun").get<string>("runtime", "bun");
      bunCommand = bunRuntime || "bun";
    } else {
      bunCommand = cmd;
    }

    const testArgs = args.length ? args : ["test"];
    if (customFlag) {
      testArgs.push(customFlag);
    }

    return { bunCommand, testArgs };
  }

  private async staticDiscoverTests(testItem?: vscode.TestItem | false, filePath?: string): Promise<void> {
    let targetPath = filePath;
    if (!targetPath && testItem) {
      targetPath = testItem?.uri?.fsPath || this.workspaceFolder.uri.fsPath;
    }

    if (!testItem && !targetPath) {
      return;
    }

    if (!targetPath) {
      return;
    }

    try {
      const fileContent = await fs.readFile(targetPath, "utf8");
      const testNodes = this.parseTestBlocks(fileContent);

      const fileUri = vscode.Uri.file(targetPath);
      let fileTestItem = this.testController.items.get(fileUri.toString());
      if (!fileTestItem) {
        fileTestItem = this.testController.createTestItem(
          fileUri.toString(),
          path.relative(this.workspaceFolder.uri.fsPath, targetPath),
          fileUri,
        );
        this.testController.items.add(fileTestItem);
      }
      fileTestItem.children.replace([]);

      this.addTestNodes(testNodes, fileTestItem, targetPath);
    } catch (err) {
      // Silent error handling
    }
  }

  private parseTestBlocks(fileContent: string): TestNode[] {
    const cleanContent = fileContent
      .replace(/\/\*[\s\S]*?\*\//g, match => " ".repeat(match.length))
      .replace(/\/\/.*$/gm, match => " ".repeat(match.length));

    const testRegex =
      /\b(describe|test|it)(?:\.(?:skip|todo|failing|only))?(?:\.(?:if|todoIf|skipIf)\s*\([^)]*\))?(?:\.each\s*\([^)]*\))?\s*\(\s*(['"`])((?:\\\2|.)*?)\2\s*,/g;

    const stack: TestNode[] = [];
    const root: TestNode[] = [];
    let match: RegExpExecArray | null;

    match = testRegex.exec(cleanContent);
    while (match !== null) {
      const [full, type, , name] = match;
      const line = cleanContent.slice(0, match.index).split("\n").length - 1;

      while (
        stack.length > 0 &&
        match.index > stack[stack.length - 1].startIdx &&
        this.getBraceDepth(cleanContent, stack[stack.length - 1].startIdx, match.index) <= 0
      ) {
        stack.pop();
      }

      const expandedNodes = this.expandEachTests(full, name, cleanContent, match.index, type as TestNode["type"], line);

      for (const node of expandedNodes) {
        if (stack.length === 0) {
          root.push(node);
        } else {
          stack[stack.length - 1].children.push(node);
        }

        if (type === "describe") {
          stack.push(node);
        }
      }
      match = testRegex.exec(cleanContent);
    }

    return root;
  }

  private getBraceDepth(content: string, start: number, end: number): number {
    const section = content.slice(start, end);
    const openBraces = (section.match(/\{/g) || []).length;
    const closeBraces = (section.match(/\}/g) || []).length;
    return openBraces - closeBraces;
  }

  private expandEachTests(
    fullMatch: string,
    name: string,
    content: string,
    index: number,
    type: TestNode["type"],
    line: number,
  ): TestNode[] {
    if (!fullMatch.includes(".each")) {
      return [
        {
          name: name.replace(/\\/g, ""),
          type,
          line,
          children: [],
          startIdx: index,
        },
      ];
    }

    const eachMatch = content.slice(index).match(/\.each\s*\(\s*(\[[\s\S]*?\])\s*\)/);
    if (!eachMatch) {
      return [
        {
          name: name.replace(/\\/g, ""),
          type,
          line,
          children: [],
          startIdx: index,
        },
      ];
    }

    try {
      const eachValues = JSON.parse(eachMatch[1]);
      if (!Array.isArray(eachValues)) {
        throw new Error("Not an array");
      }

      return eachValues.map(val => {
        let testName = name;
        if (Array.isArray(val)) {
          let idx = 0;
          testName = testName.replace(/%[isfd]/g, () => {
            const v = val[idx++];
            return typeof v === "object" ? JSON.stringify(v) : String(v);
          });
        } else {
          testName = testName.replace(/%[isfd]/g, () => {
            return typeof val === "object" ? JSON.stringify(val) : String(val);
          });
        }

        return {
          name: testName,
          type,
          line,
          children: [],
          startIdx: index,
        };
      });
    } catch {
      return [
        {
          name: name.replace(/\\/g, ""),
          type,
          line,
          children: [],
          startIdx: index,
        },
      ];
    }
  }

  private addTestNodes(nodes: TestNode[], parent: vscode.TestItem, filePath: string, parentPath = ""): void {
    for (const node of nodes) {
      const nodePath = parentPath
        ? `${parentPath} > ${this.escapeTestName(node.name)}`
        : this.escapeTestName(node.name);
      const testId = `${filePath}#${nodePath}`;

      const testItem = this.testController.createTestItem(testId, node.name, vscode.Uri.file(filePath));

      testItem.tags = [new vscode.TestTag(node.type === "describe" ? "describe" : "test")];

      if (typeof node.line === "number") {
        testItem.range = new vscode.Range(
          new vscode.Position(node.line, 0),
          new vscode.Position(node.line, node.name.length),
        );
      }

      parent.children.add(testItem);

      if (node.children.length > 0) {
        this.addTestNodes(node.children, testItem, filePath, nodePath);
      }
    }
  }

  private escapeTestName(source: string): string {
    return source.replace(/[^a-zA-Z0-9_\ ]/g, "\\$&");
  }

  private async runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    isDebug: boolean,
  ): Promise<void> {
    const run = this.testController.createTestRun(request);

    token.onCancellationRequested(() => {
      run.end();
      this.closeAllActiveProcesses();
    });

    const queue: vscode.TestItem[] = [];

    if (request.include) {
      for (const test of request.include) {
        queue.push(test);
      }
    } else {
      for (const [, test] of this.testController.items) {
        queue.push(test);
      }
    }

    if (isDebug) {
      await this.debugTests(queue, request, run);
      run.end();
      return;
    }

    const testsByFile = new Map<string, vscode.TestItem[]>();

    for (const test of queue) {
      if (!test.uri) {
        continue;
      }

      const filePath = test.uri.fsPath;
      if (!testsByFile.has(filePath)) {
        testsByFile.set(filePath, []);
      }
      testsByFile.get(filePath)?.push(test);
      run.enqueued(test);
    }

    let i = 0;

    for (const [filePath, tests] of testsByFile.entries()) {
      if (token.isCancellationRequested) break;

      try {
        for (const test of tests) {
          run.started(test);
          this.markTestsAsRunning(test, run);
        }

        const { bunCommand, testArgs } = this.getBunExecutionConfig();
        const args = testArgs.concat([process.platform === "win32" ? `"${filePath}"` : filePath]);

        const testUriString = tests[0].uri?.toString();
        const testIdEndsWithFileName = tests[0].uri && tests[0].label === tests[0].uri.fsPath.split("/").pop();

        const isFileOnly =
          tests.length === 1 &&
          tests[0].uri &&
          (testIdEndsWithFileName || !tests[0].id.includes("#") || tests[0].id === testUriString);

        function hasManyTests() {
          let current = tests[0];
          while (current.parent) {
            if (current.parent.children.size > 1) {
              return true;
            }
            current = current.parent;
          }
          return false;
        }

        if (!isFileOnly && hasManyTests()) {
          const testNames = [];
          for (const test of tests) {
            let t = test.id
              .slice(test.id.indexOf("#") + 1)
              .split(" > ")
              .join(" ");
            t = t.replaceAll(/\$\{[^}]+\}/g, ".*?");
            t = t.replaceAll(/\\\$\\\{[^}]+\\\}/g, ".*?");
            t = t.replaceAll(/\\%[isfd]/g, ".*?");

            if (test.tags.some(tag => tag.id === "test" || tag.id === "it")) {
              testNames.push(`^ ${t}$`);
            } else {
              testNames.push(`^ ${t}`);
            }
          }

          if (testNames.length > 0) {
            const testNamesRegex = testNames.map(pattern => `(${pattern})`).join("|");
            args.push("--test-name-pattern", testNamesRegex);
          }
        }

        const command = process.platform === "win32" ? `"${bunCommand}"` : bunCommand;
        const commandArgs = args;

        const printArgs = args
          .map(e => (e === "test" || e.startsWith('"') || e.startsWith("--") || e.startsWith("\'") ? e : `"${e}"`))
          .join(" ");

        const buncmd = bunCommand.split("/").pop() || bunCommand;
        run.appendOutput(`\r\n\x1b[34m>\x1b[0m \x1b[2m${buncmd} ${printArgs}\x1b[0m\r\n\r\n`);

        const tempfile = `${tmpdir()}/bun-test-${randomUUID()}.xml`;
        commandArgs.push("--reporter-outfile", tempfile, "--reporter=junit");

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(command, commandArgs, {
            cwd: this.workspaceFolder.uri.fsPath,
            shell: process.platform === "win32",
            env: {
              FORCE_COLOR: "1",
              NO_COLOR: "0",
              BUN_DEBUG_QUIET_LOGS: "1",
              GITHUB_ACTIONS: "true",
              ...globalThis.process.env,
            },
          });

          let stdout = "";
          let stderr = "";
          let output = "";

          proc.stdout?.on("data", data => {
            const chunk = data.toString();
            stdout += chunk;
            output += chunk;
            const filtered = chunk
              .split(/\r?\n/)
              .filter(
                (line: string) =>
                  !line.startsWith("::group::") && !line.startsWith("::error ") && !line.startsWith("::endgroup::"),
              )
              .join("\r\n");
            run.appendOutput(filtered);
          });

          proc.stderr?.on("data", data => {
            const chunk = data.toString();
            stderr += chunk;
            output += chunk;
            const filtered = chunk
              .split(/\r?\n/)
              .filter(
                (line: string) =>
                  !line.startsWith("::group::") && !line.startsWith("::error ") && !line.startsWith("::endgroup::"),
              )
              .join("\r\n");
            run.appendOutput(filtered);
          });

          proc.stdin?.on("data", data => {
            const chunk = data.toString();
            if (chunk.trim().toLowerCase() === "exit") {
              proc.kill();
            }
          });

          proc.on("close", code => {
            this.activeProcesses.delete({ process: proc, kill: () => proc.kill() });

            try {
              if (code === 0 || code === 1) {
                const parsedOutput = parseBunTestOutput(output, this.workspaceFolder.uri.fsPath, tempfile);
                fs.rm(tempfile).catch(() => {});

                if (!parsedOutput) {
                  for (const test of tests) {
                    run.errored(test, new vscode.TestMessage("Failed to parse test output"));
                    if (test.uri) {
                      const location = new vscode.Location(test.uri, new vscode.Position(0, 0));
                      run.appendOutput(`Error: Failed to parse test output for ${test.id}\n`, location);
                    }
                    this.removeTestItemAndChildren(test);
                  }
                  resolve();
                  return;
                }

                if (isFileOnly) {
                  const fileTestItem = this.testController.items.get(vscode.Uri.file(filePath).toString());
                  if (fileTestItem) {
                    this.removeTestItemAndChildren(fileTestItem);
                  }

                  this.createTestItemsFromParsedOutput(parsedOutput);

                  const fileResult = parsedOutput.find((result: BunFileResult) => result.name === filePath);
                  if (fileResult) {
                    const newFileTestItem = this.testController.items.get(vscode.Uri.file(filePath).toString());
                    if (newFileTestItem) {
                      this.processTestResults(fileResult.tests, run, newFileTestItem, "", 0, true);
                    }
                  }
                } else {
                  const fileResult = parsedOutput.find((result: BunFileResult) => result.name === filePath);
                  if (fileResult) {
                    this.createTestItemsFromParsedOutput(parsedOutput);

                    for (const test of tests) {
                      const findResult = (results: BunTestResult[], label: string): BunTestResult | undefined => {
                        for (const r of results) {
                          if (r.name === label) return r;
                          if (r.children) {
                            const found = findResult(r.children, label);
                            if (found) return found;
                          }
                        }
                        return undefined;
                      };
                      const result = findResult(fileResult.tests, test.label);
                      if (result) {
                        this.processTestResults([result], run, test, "", 0, true);
                      } else {
                        this.removeTestItemAndChildren(test);
                      }
                    }
                  } else {
                    for (const test of tests) {
                      run.skipped(test);
                    }
                  }
                }
              } else {
                for (const test of tests) {
                  run.errored(test, new vscode.TestMessage(`Bun process exited with code ${code}:\n${stderr}`));
                  if (test.uri) {
                    const location = new vscode.Location(test.uri, new vscode.Position(0, 0));
                    run.appendOutput(`Error running test: ${stderr}\n`, location);
                  }
                }
              }
            } catch (e) {
              for (const test of tests) {
                run.errored(test, new vscode.TestMessage(`Error processing test results: ${e}`));
                if (test.uri) {
                  const location = new vscode.Location(test.uri, new vscode.Position(0, 0));
                  run.appendOutput(`Error processing test results: ${e}\n`, location);
                }
                this.removeTestItemAndChildren(test);
              }
            } finally {
              if (i++ >= testsByFile.size - 1) {
                run.end();
              }
              resolve();
            }
          });

          proc.on("error", err => {
            for (const test of tests) {
              run.errored(test, new vscode.TestMessage(`Error: ${err}`));
              if (test.uri) {
                const location = new vscode.Location(test.uri, new vscode.Position(0, 0));
                run.appendOutput(`Error running test: ${err}\n`, location);
              }
              if (test.parent) {
                test.parent.children.delete(test.id);
              } else {
                this.testController.items.delete(test.id);
              }
            }
            run.end();
          });

          this.activeProcesses.add({ process: proc, kill: () => proc.kill() });
        });
      } catch (error) {
        for (const test of tests) {
          run.errored(test, new vscode.TestMessage(`Error: ${error}`));
          if (test.uri) {
            const location = new vscode.Location(test.uri, new vscode.Position(0, 0));
            run.appendOutput(`Error running test: ${error}\n`, location);
          }
          if (test.parent) {
            test.parent.children.delete(test.id);
          } else {
            this.testController.items.delete(test.id);
          }
        }
        run.end();
      }
    }
  }

  private markTestsAsRunning(test: vscode.TestItem, run: vscode.TestRun): void {
    if (!test) return;

    run.started(test);

    if (test.children) {
      for (const [, child] of test.children) {
        if (child) {
          this.markTestsAsRunning(child, run);
        }
      }
    }
  }

  private isRelatedTestResult(testItem: vscode.TestItem, testResult: BunTestResult): boolean {
    if (testResult.name === testItem.label) {
      return true;
    }

    if ("tests" in testResult && Array.isArray((testResult as Record<string, unknown>).tests)) {
      for (const test of (testResult as Record<string, unknown>).tests as BunTestResult[]) {
        if (this.isRelatedTestResult(testItem, test)) {
          return true;
        }
      }
    }

    if (testResult.children && testResult.children.length > 0) {
      for (const child of testResult.children) {
        if (this.isRelatedTestResult(testItem, child)) {
          return true;
        }
      }
    }

    if (testItem.children && testItem.children.size > 0) {
      for (const [, child] of testItem.children) {
        if (this.isRelatedTestResult(child, testResult)) {
          return true;
        }
      }
    }

    return false;
  }

  private processTestResults(
    tests: BunTestResult[],
    run: vscode.TestRun,
    parent: vscode.TestItem,
    parentPath = "",
    indentLevel = 0,
    isLastBatch = true,
  ): void {
    if (!parent.uri) {
      return;
    }

    for (let i = 0; i < tests.length; i++) {
      const testResult = tests[i];
      const isLastTest = i === tests.length - 1;

      let testItem = parent;

      if (testResult.name.trim() !== parent.label.trim() && parent.children.size > 0) {
        const foundChild = this.findMatchingTestItem(parent, testResult);
        if (foundChild) {
          testItem = foundChild;
        } else if (!this.isRelatedTestResult(parent, testResult)) {
          continue;
        }
      } else if (!this.isRelatedTestResult(parent, testResult)) {
        continue;
      }

      let location: vscode.Location | undefined;
      if (testItem.uri) {
        let line = 0;
        let column = 0;

        if (testResult.location) {
          line = testResult.location.line > 0 ? testResult.location.line - 1 : 0;
          column = Math.max(0, testResult.location.column);
        }

        let fileUri = testItem.uri;
        if (
          testItem.id.endsWith(" tests skipped") &&
          testResult.location &&
          testResult.location.file &&
          !testResult.location.file.endsWith(" tests skipped")
        ) {
          fileUri = vscode.Uri.file(testResult.location.file);
        }

        const position = new vscode.Position(line, column);
        location = new vscode.Location(fileUri, position);
      }

      const isParent = testResult.children && testResult.children.length > 0;

      if (testResult.status === "skipped") {
        if (!testResult.status || testResult.status === "skipped") {
          run.skipped(testItem);
        }
        if (isParent && testItem && testResult.children) {
          this.processTestResults(testResult.children, run, testItem, "", indentLevel + 1, false);
        }
        continue;
      }

      if (testResult.status === "passed") {
        run.passed(testItem, testResult.duration);
      } else if (testResult.status === "failed") {
        const message = processErrorData({ testResult, testItem });
        if (message) {
          run.failed(testItem, message, testResult.duration);
        } else {
          run.failed(testItem, [], testResult.duration);
        }
      } else if (testItem.id.includes(" tests skipped")) {
        if (!testResult.status || testResult.status === "skipped") {
          run.skipped(testItem);
        }
      }

      if (isParent && testItem && testResult.children) {
        this.processTestResults(testResult.children, run, testItem, "", indentLevel + 1, false);
      }

      if (isLastTest && isLastBatch && indentLevel === 0 && location) {
        run.appendOutput("\r\n", location);
      }
    }
  }

  private async debugTests(
    tests: vscode.TestItem[],
    request: vscode.TestRunRequest,
    run: vscode.TestRun,
  ): Promise<void> {
    const testFiles = new Set<string>();

    const testUriString = tests[0].uri?.toString();
    const testIdEndsWithFileName = tests[0].uri && tests[0].label === tests[0].uri.fsPath.split("/").pop();

    const isFileOnly =
      tests.length === 1 &&
      tests[0].uri &&
      (testIdEndsWithFileName || !tests[0].id.includes("#") || tests[0].id === testUriString);

    for (const test of tests) {
      if (test.uri) {
        testFiles.add(test.uri.fsPath);
      }
    }

    if (testFiles.size === 0) {
      run.end();
      return;
    }

    const { bunCommand, testArgs } = this.getBunExecutionConfig();
    const args = [...testArgs, ...testFiles];

    const testNames = [];
    const breakpoints: vscode.SourceBreakpoint[] = [];
    for (const test of tests) {
      let t = test.id.includes("#")
        ? test.id
            .slice(test.id.indexOf("#") + 1)
            .split(" > ")
            .join(" ")
        : test.label;

      t = t.replaceAll(/\$\{[^}]+\}/g, ".*?");
      t = t.replaceAll(/\\\$\\\{[^}]+\\\}/g, ".*?");
      t = t.replaceAll(/\\%[isfd]/g, ".*?");

      if (test.tags.some(tag => tag.id === "test" || tag.id === "it")) {
        testNames.push(`^ ${t}$`);
      } else {
        testNames.push(`^ ${t}`);
      }

      if (test.uri) {
        breakpoints.push(
          new vscode.SourceBreakpoint(
            new vscode.Location(test.uri, new vscode.Position((test.range?.end.line ?? 0) + 1, 0)),
            true,
          ),
        );
      }
    }
    vscode.debug.addBreakpoints(breakpoints);

    if (testNames.length > 0) {
      const testNamesRegex = testNames.map(pattern => `(${pattern})`).join("|");
      args.push("--test-name-pattern", testNamesRegex);
    }

    const debugConfiguration: vscode.DebugConfiguration = {
      args: args.slice(1),
      console: "integratedTerminal",
      cwd: "${workspaceFolder}",
      internalConsoleOptions: "neverOpen",
      name: "Bun Test Debug",
      program: args.at(1),
      request: "launch",
      runtime: bunCommand,
      type: "bun",
    };

    try {
      await vscode.debug.startDebugging(this.workspaceFolder, debugConfiguration);
    } catch (error) {
      for (const test of tests) {
        run.errored(test, new vscode.TestMessage(`Error starting debugger: ${error}`));
      }
    }
    run.end();
  }

  private closeAllActiveProcesses(): void {
    for (const p of this.activeProcesses) {
      p.kill();
    }
    this.activeProcesses.clear();
  }

  private findMatchingTestItem(parent: vscode.TestItem, testResult: BunTestResult): vscode.TestItem | undefined {
    let foundItem: vscode.TestItem | undefined;

    for (const [, child] of parent.children) {
      if (child.label.trim() === testResult.name.trim()) {
        foundItem = child;
        break;
      }
    }

    if (!foundItem) {
      for (const [, child] of parent.children) {
        if (!foundItem && child.children.size > 0) {
          const found = this.findMatchingTestItem(child, testResult);
          if (found) {
            foundItem = found;
            break;
          }
        }
      }
    }

    return foundItem;
  }

  private removeTestItemAndChildren(testItem: vscode.TestItem) {
    if (testItem.children && testItem.children.size > 0) {
      for (const [, child] of testItem.children) {
        this.removeTestItemAndChildren(child);
      }
    }
    if (testItem.parent) {
      testItem.parent.children.delete(testItem.id);
    } else {
      this.testController.items.delete(testItem.id);
    }
  }

  private createTestItemsFromParsedOutput(parsedOutput: BunFileResult[]): void {
    for (const fileResult of parsedOutput) {
      const fileUri = vscode.Uri.file(fileResult.name);
      let fileTestItem = this.testController.items.get(fileUri.toString());

      if (!fileTestItem) {
        fileTestItem = this.testController.createTestItem(
          fileUri.toString(),
          path.relative(this.workspaceFolder.uri.fsPath, fileResult.name),
          fileUri,
        );
        this.testController.items.add(fileTestItem);
      }

      fileTestItem.children.replace([]);
      this.addTestResultChildren(fileResult.tests, fileTestItem, fileResult.name);
    }
  }

  private addTestResultChildren(
    tests: BunTestResult[],
    parent: vscode.TestItem,
    fileName: string,
    parentPath = "",
  ): void {
    for (const test of tests) {
      const path = parentPath ? `${parentPath} > ${this.escapeTestName(test.name)}` : this.escapeTestName(test.name);
      const testId = `${fileName}#${path}`;

      const fileUri = parent.uri || vscode.Uri.file(fileName);
      if (
        fileName.endsWith(" tests skipped") &&
        test.location &&
        test.location.file &&
        !test.location.file.endsWith(" tests skipped")
      ) {
        // fileUri = vscode.Uri.file(test.location.file);
      }

      const testItem = this.testController.createTestItem(testId, test.name, fileUri);

      if (fileName.endsWith(" tests skipped") && !parentPath) {
        testItem.description = fileUri.fsPath.split("/").pop();
      }

      testItem.tags = [new vscode.TestTag(test.children ? "describe" : "test")];

      if (test.location && test.location.line > 0) {
        const line = Math.max(0, test.location.line - 1);
        const column = Math.max(0, test.location.column);
        const location = new vscode.Location(fileUri, new vscode.Position(line, column));
        testItem.range = new vscode.Range(location.range.start, location.range.start.translate(0, test.name.length));
      }

      parent.children.add(testItem);

      if (test.children && test.children.length > 0) {
        this.addTestResultChildren(test.children, testItem, fileName, path);
      }
    }
  }

  public dispose(): void {
    this.closeAllActiveProcesses();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}

function getFileLocationFromError(
  error: string,
  _expectedFile: string,
): { file: string; line: number; column: number } | undefined {
  const expectedFile = _expectedFile.replace(/\\/g, "/");

  const regex = /at .*? \((.*):(\d+):(\d+)\)/g;
  let match: RegExpExecArray | null;
  let first: { file: string; line: number; column: number } | undefined = undefined;

  match = regex.exec(error);
  while (match !== null) {
    const file = match[1].replace(/\\/g, "/");
    const line = Number.parseInt(match[2], 10);
    const column = Number.parseInt(match[3], 10) - 1;

    if (file === expectedFile) {
      return { file, line, column };
    }

    if (!first) {
      first = { file, line, column };
    }
    match = regex.exec(error);
  }

  return first;
}

function parseBunTestOutput(output: string, workspacePath: string, reporterOutfile?: string): BunFileResult[] {
  const lines = output.trim().split("\n");
  const testResults: BunFileResult[] = [];

  let xmlResult: unknown | null = null;
  if (reporterOutfile && fsSync.existsSync(reporterOutfile)) {
    const xml = fsSync.readFileSync(reporterOutfile, "utf8");
    xmlParseString(xml, { explicitArray: false, mergeAttrs: true }, (err: unknown, result: unknown) => {
      if (!err) xmlResult = result;
    });
  }

  const outputWithoutAnsi = output;
  const errorRegex = /::error file=(.*?),line=(\d+),col=(\d+),title=(.*?)::(.*?)(?=\n|$)/g;
  const errors: Array<{
    file: string;
    line: number;
    col: number;
    title: string;
    message: string;
    testName?: string;
    lineIdx?: number;
  }> = [];

  let match: RegExpExecArray | null;
  let lastErrorIndex = -1;

  match = errorRegex.exec(outputWithoutAnsi);
  while (match !== null) {
    const [full, file, line, col, title, msg] = match;
    const errorLineIdx = lines.findIndex(
      (l, idx) => idx > lastErrorIndex && l.includes(`::error file=${file},line=${line},col=${col},title=${title}::`),
    );
    lastErrorIndex = errorLineIdx === -1 ? lastErrorIndex : errorLineIdx;
    let testName: string | undefined;
    for (let i = errorLineIdx + 1; i < lines.length; ++i) {
      const testLineMatch = lines[i].match(/^[✗✓»] (.+?) (\[.*\])?/);
      if (testLineMatch) {
        testName = testLineMatch[1];
        break;
      }
    }
    errors.push({
      file,
      line: Number(line),
      col: Number(col),
      title,
      message: decodeURIComponent(msg.replace(/%0A/g, "\n")),
      testName,
      lineIdx: errorLineIdx,
    });
    match = errorRegex.exec(outputWithoutAnsi);
  }

  const errorMsgMap: Map<string, string> = new Map();
  if (lines && errors && errors.length > 0) {
    const testLineInfos: { name: string; lineIdx: number; fullName: string[] }[] = [];
    for (let i = 0; i < lines.length; ++i) {
      const line = lines[i]
        .replaceAll("\u001b[0m", "")
        .replaceAll("\u001b[31m", "")
        .replace("\u001b[0m\u001b[2m\[\u001b[1m", "[")
        .replace("\u001b[2m\[", "[")
        .replace("\u001b[0m\u001b[2m\]\u001b[0m", "]")
        .replace("\u001b[2m\]", "]")
        .replaceAll("\u001b[1m", "");

      const m = line.match(/^[✗✓»] (.+?)( \[.*\])?$/m);
      if (m) {
        const fullName = m[1].split("\u001b[2m > ").map(s => s.trim());
        testLineInfos.push({ name: m[1].trim(), lineIdx: i, fullName });
      }
    }

    for (const testLine of testLineInfos) {
      let bestError: (typeof errors)[0] | undefined;
      for (const err of errors) {
        if (typeof err.lineIdx === "number" && err.lineIdx < testLine.lineIdx) {
          if (!bestError || err.lineIdx > (bestError.lineIdx ?? -1)) {
            bestError = err;
          }
        }
      }
      if (bestError) {
        errorMsgMap.set(
          JSON.stringify(testLine.fullName),
          `${bestError.title.trim()}\n${bestError.message.trim()}`.trim(),
        );
      }
    }
  }

  function parseXmlSuite(suite: Record<string, unknown>, parentChain: string[] = []): BunTestResult[] {
    const results: BunTestResult[] = [];
    if (suite.testsuite) {
      const suites = Array.isArray(suite.testsuite) ? suite.testsuite : [suite.testsuite];
      for (const childSuite of suites as Record<string, unknown>[]) {
        const describeName = childSuite.name as string;
        const line = childSuite.line !== undefined ? Number(childSuite.line) : 0;
        const file = childSuite.file
          ? path.isAbsolute(childSuite.file as string)
            ? (childSuite.file as string)
            : path.resolve(workspacePath, childSuite.file as string)
          : suite.file
            ? path.isAbsolute(suite.file as string)
              ? (suite.file as string)
              : path.resolve(workspacePath, suite.file as string)
            : undefined;
        const children = parseXmlSuite(childSuite, [...parentChain, describeName]);
        const status = children.some(c => c.status === "failed") ? "failed" : "passed";
        results.push({
          name: describeName,
          status,
          location: {
            file: file || (suite.name as string),
            line,
            column: 0,
          },
          duration: childSuite.time !== undefined ? Number(childSuite.time) * 1000 : undefined,
          ...(parentChain.length > 0 ? { parent: parentChain.join(" > ") } : {}),
          children,
        });
      }
    }

    if (suite.testcase) {
      const testcases = Array.isArray(suite.testcase) ? suite.testcase : [suite.testcase];
      for (const testcase of testcases as Record<string, unknown>[]) {
        const name = testcase.name as string;
        const classname = (testcase.classname as string) || "";
        const fullParent = parentChain.length ? parentChain.join(" > ") : classname || undefined;
        const line = testcase.line !== undefined ? Number(testcase.line) : 0;
        const file = testcase.file
          ? path.isAbsolute(testcase.file as string)
            ? (testcase.file as string)
            : path.resolve(workspacePath, testcase.file as string)
          : suite.file
            ? path.isAbsolute(suite.file as string)
              ? (suite.file as string)
              : path.resolve(workspacePath, suite.file as string)
            : undefined;
        const status =
          testcase.skipped !== undefined ? "skipped" : testcase.failure !== undefined ? "failed" : "passed";
        const duration = testcase.time !== undefined ? Number(testcase.time) * 1000 : undefined;

        let errorMsg: string | undefined;
        if (status === "failed") {
          const fullName = JSON.stringify([...parentChain.map(e => e.trim()), name.trim()]);

          if (errorMsgMap?.has(fullName)) {
            errorMsg = errorMsgMap.get(fullName);
          }

          if (!errorMsg) {
            const failure = testcase.failure as Record<string, unknown>;
            if (failure && typeof failure === "object" && typeof failure._ === "string") {
              errorMsg = failure._.trim();
            } else if (typeof testcase.failure === "string") {
              errorMsg = testcase.failure.trim();
            }
          }
          if (!errorMsg) errorMsg = `Test "${name}" failed (no error message available)`;
        }

        results.push({
          name,
          status,
          ...(errorMsg !== undefined ? { message: errorMsg } : {}),
          ...(duration !== undefined && duration > 0 ? { duration } : {}),
          location: {
            file: file || (suite.name as string),
            line,
            column: 0,
          },
          ...(fullParent ? { parent: fullParent } : {}),
        });
      }
    }
    return results;
  }

  if (xmlResult && typeof xmlResult === "object" && xmlResult !== null) {
    const xmlObj = xmlResult as Record<string, unknown>;
    if (xmlObj.testsuites && typeof xmlObj.testsuites === "object") {
      const testsuites = xmlObj.testsuites as Record<string, unknown>;
      if (testsuites.testsuite) {
        const suites = Array.isArray(testsuites.testsuite) ? testsuites.testsuite : [testsuites.testsuite];
        for (const suite of suites as Record<string, unknown>[]) {
          const fileName = suite.name as string;
          const filePath = path.isAbsolute(fileName) ? fileName : path.resolve(workspacePath, fileName);

          const topLevel = parseXmlSuite(suite);
          const idx = testResults.findIndex(r => r.name === filePath);
          if (idx !== -1) testResults.splice(idx, 1);

          testResults.push({
            name: filePath,
            tests: topLevel,
            passed: topLevel.every(t => t.status === "passed"),
          });
        }
      }
    }
  }

  return testResults;
}

function processErrorData({
  testResult,
  testItem,
}: {
  testResult: BunTestResult;
  testItem: vscode.TestItem;
}): vscode.TestMessage | undefined {
  if (!testResult.message) {
    return undefined;
  }

  const messageLinesRaw = testResult.message.split("\n");
  const stackTraceIndex = messageLinesRaw.findIndex(
    line =>
      line.trim().startsWith("at ") &&
      line.includes("(") &&
      line.includes(":") &&
      line.includes(testItem.uri?.fsPath || ""),
  );
  let lines: string[];
  if (stackTraceIndex !== -1) {
    lines = messageLinesRaw.slice(0, stackTraceIndex + 1).map(line => line);
  } else {
    lines = messageLinesRaw.map(line => line);
  }

  const errorLine = lines[0].trim();
  const messageLines = lines.slice(1, -1).join("\n");
  const fileLine = lines.slice(-1)[0].trim();

  const filepath = getFileLocationFromError(fileLine, testItem.uri?.fsPath || "");

  if (!filepath) {
    return new vscode.TestMessage(testResult.message);
  }

  const messageLocation = new vscode.Location(
    vscode.Uri.file(filepath.file),
    new vscode.Position(filepath.line - 1, filepath.column),
  );

  const errorType = errorLine.replace(/^(E|e)rror: /, "").trim();
  switch (errorType) {
    case "expect(received).toMatchInlineSnapshot(expected)":
    case "expect(received).toMatchSnapshot(expected)":
    case "expect(received).toEqual(expected)":
    case "expect(received).toBe(expected)": {
      const regex = /^Expected:\s*([\s\S]*?)\nReceived:\s*([\s\S]*?)$/;
      let message = vscode.TestMessage.diff(
        errorLine,
        messageLines.match(regex)?.[1].trim() || "",
        messageLines.match(regex)?.[2].trim() || "",
      );
      if (!messageLines.match(regex)) {
        const code = messageLines
          .replace(/(?:\r?\n)+(- Expected\s+- \d+|\+ Received\s+\+ \d+)\s*$/g, "")
          .replace(/(?:\r?\n)+(- Expected\s+- \d+|\+ Received\s+\+ \d+)\s*$/g, "")
          .trim();
        message = new vscode.TestMessage(
          new vscode.MarkdownString("Values did not match:\n").appendCodeblock(code, "diff"),
        );
      }
      message.location = messageLocation;
      return message;
    }

    case "expect(received).toBeInstanceOf(expected)": {
      const regex = /^Expected constructor:\s*([\s\S]*?)\nReceived value:\s*([\s\S]*?)$/;
      let message = vscode.TestMessage.diff(
        errorLine,
        messageLines.match(regex)?.[1].trim() || "",
        messageLines.match(regex)?.[2].trim() || "",
      );
      if (!messageLines.match(regex)) {
        message = new vscode.TestMessage(messageLines);
      }
      message.location = messageLocation;
      return message;
    }

    case "expect(received).not.toBe(expected)":
    case "expect(received).not.toEqual(expected)": {
      const message = new vscode.TestMessage(messageLines);
      message.location = messageLocation;
      return message;
    }

    case "expect(received).toBeNull()": {
      const actualValue = messageLines.replace("Received:", "").trim();
      const message = vscode.TestMessage.diff(errorLine, "null", actualValue);
      message.location = messageLocation;
      return message;
    }
    case "expect(received).toBeTruthy()": {
      const message = vscode.TestMessage.diff(errorLine, "true", messageLines.replace("Received: ", "").trim());
      message.location = messageLocation;
      return message;
    }
    case "expect(received).toBeFalsy()": {
      const message = vscode.TestMessage.diff(errorLine, "false", messageLines.replace("Received: ", "").trim());
      message.location = messageLocation;
      return message;
    }
    case "expect(received).toBeUndefined()": {
      const message = vscode.TestMessage.diff(errorLine, "undefined", messageLines.replace("Received: ", "").trim());
      message.location = messageLocation;
      return message;
    }
    case "expect(received).toBeNaN()": {
      const message = vscode.TestMessage.diff(errorLine, "NaN", messageLines.replace("Received: ", "").trim());
      message.location = messageLocation;
      return message;
    }

    case "expect(received).toBeLessThanOrEqual(expected)":
    case "expect(received).toBeLessThan(expected)":
    case "expect(received).toBeGreaterThanOrEqual(expected)":
    case "expect(received).toBeGreaterThan(expected)": {
      const regex = /^Expected: (.*?)\nReceived: (.*?)$/;
      const message = new vscode.TestMessage(
        `${messageLines.trim().match(regex)?.[2]?.trim()} isn't ${messageLines.trim().match(regex)?.[1]?.trim()}\n\n${messageLines}`,
      );
      message.location = messageLocation;
      return message;
    }

    case "expect(received).toStrictEqual(expected)":
    case "expect(received).toMatchObject(expected)": {
      const line = messageLines
        .replace(/(?:\r?\n)+(- Expected\s+- \d+|\+ Received\s+\+ \d+)\s*$/g, "")
        .replace(/(?:\r?\n)+(- Expected\s+- \d+|\+ Received\s+\+ \d+)\s*$/g, "");

      const formatted = new vscode.MarkdownString("Values did not match:");
      formatted.appendCodeblock(line, "diff");
      const message = new vscode.TestMessage(formatted);
      message.location = messageLocation;

      return message;
    }
  }

  let lastEffortMsg = messageLines.split("\n");
  const lastLine = lastEffortMsg?.at(-1);
  if (lastLine?.startsWith("Received ") || lastLine?.startsWith("Received: ")) {
    lastEffortMsg = lastEffortMsg.reverse();
  }

  const msg = errorLine.startsWith("error: expect")
    ? `${lastEffortMsg.join("\n")}\n${errorLine.trim()}`.trim()
    : `${errorLine.trim()}\n${messageLines}`.trim();

  const message = new vscode.TestMessage(msg);
  message.location = messageLocation;
  return message;
}
