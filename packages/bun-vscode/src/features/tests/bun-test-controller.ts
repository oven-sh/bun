import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { getAvailablePort, TCPSocketSignal, UnixSignal } from "../../../../bun-debug-adapter-protocol";
import type { TestNode } from "./types";

const DEFAULT_TEST_PATTERN = "**/*{.test.,.spec.,_test_,_spec_}{js,ts,tsx,jsx,mts,cts,cjs,mjs}";

const output = vscode.window.createOutputChannel("Bun - Test Runner");

interface InspectorMessage {
  method: string;
  params?: any;
  id?: number;
  result?: any;
  error?: any;
}

interface TestFoundEvent {
  id: number;
  url: string;
  line: number;
  name: string;
  type: string;
  parentId: number;
}

interface TestStartEvent {
  id: number;
}

interface TestEndEvent {
  id: number;
  status: "pass" | "fail" | "timeout" | "skip" | "todo";
  elapsed: number;
}

interface LifecycleErrorEvent {
  message: string;
  name: string;
  urls: string[];
  lineColumns: number[];
  sourceLines: string[];
}

class InspectorConnection {
  private ws: any | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
  private connected = false;

  constructor(private onMessage: (message: InspectorMessage) => void) {}

  async connect(url: string): Promise<void> {
    output.appendLine(`Attempting to connect to inspector at ${url}`);

    return new Promise((resolve, reject) => {
      try {
        const WebSocket = require("ws");
        this.ws = new WebSocket(url);

        this.ws.on("open", () => {
          this.connected = true;
          output.appendLine(`Inspector connected to ${url}`);
          resolve();
        });

        this.ws.on("error", (error: Error) => {
          output.appendLine(`Inspector connection error: ${error.message}`);
          reject(error);
        });

        this.ws.on("message", (data: any) => {
          try {
            const message = JSON.parse(data.toString()) as InspectorMessage;
            output.appendLine(`Inspector received: ${message.method || "response"}`);
            this.onMessage(message);

            if (message.id && this.pendingRequests.has(message.id)) {
              const request = this.pendingRequests.get(message.id)!;
              this.pendingRequests.delete(message.id);

              if (message.error) {
                request.reject(new Error(message.error.message || "Inspector error"));
              } else {
                request.resolve(message.result);
              }
            }
          } catch (error) {
            output.appendLine(`Failed to parse inspector message: ${data.toString()}`);
          }
        });

        this.ws.on("close", () => {
          this.connected = false;
          output.appendLine("Inspector connection closed");
        });
      } catch (error) {
        output.appendLine(`Failed to create WebSocket: ${error}`);
        reject(error);
      }
    });
  }

  async send(method: string, params?: any): Promise<any> {
    if (!this.connected || !this.ws) {
      throw new Error("Inspector not connected");
    }

    const id = this.requestId++;
    const message = { id, method, params };

    output.appendLine(`Inspector sending: ${method}`);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const messageStr = JSON.stringify(message);
      this.ws.send(messageStr);

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Inspector request timeout: ${method}`));
        }
      }, 10000);
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }
}

export class BunTestController implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private activeProcesses: Set<ChildProcess> = new Set();
  private inspectorConnection: InspectorConnection | null = null;
  private testIdToVSCodeTest = new Map<number, vscode.TestItem>();
  private lastTestId = 0;
  private currentRun: vscode.TestRun | null = null;

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
      if (!testItem) return;
      return this.staticDiscoverTests(testItem);
    };

    this.testController.refreshHandler = async token => {
      const files = await this.discoverInitialTests(token);
      if (!files) return;

      for (const [, testItem] of this.testController.items) {
        if (!files.some(file => file.fsPath === testItem.uri?.fsPath)) {
          this.testController.items.delete(testItem.id);
        }
      }
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
    if (this.isTestFile(document) && !this.testController.items.get(windowsVscodeUri(document.uri.fsPath))) {
      this.staticDiscoverTests(false, windowsVscodeUri(document.uri.fsPath));
    }
  }

  private isTestFile(document: vscode.TextDocument): boolean {
    return document?.uri?.scheme === "file" && /\.(test|spec)\.(js|jsx|ts|tsx|cjs|mts)$/.test(document.uri.fsPath);
  }

  private async discoverInitialTests(cancellationToken?: vscode.CancellationToken): Promise<vscode.Uri[] | undefined> {
    try {
      const tests = await this.findTestFiles(cancellationToken);
      output.appendLine(`Discovered ${tests.length} test files.`);
      this.createFileTestItems(tests);
      return tests;
    } catch (error) {
      output.appendLine(`Error discovering initial tests: ${error}`);
    }
  }

  private customFilePattern(): string {
    return vscode.workspace.getConfiguration("bun.test").get("filePattern", DEFAULT_TEST_PATTERN);
  }

  private async findTestFiles(cancellationToken?: vscode.CancellationToken): Promise<vscode.Uri[]> {
    const ignoreGlobs = await this.buildIgnoreGlobs(cancellationToken);
    const tests = await vscode.workspace.findFiles(
      this.customFilePattern(),
      "node_modules",
      undefined,
      cancellationToken,
    );

    return tests.filter(test => {
      const normalizedTestPath = test.fsPath.replace(/\\/g, "/");
      return !ignoreGlobs.some(glob => {
        const normalizedGlob = glob.replace(/\\/g, "/").replace(/^\.\//, "");
        return normalizedTestPath.includes(normalizedGlob);
      });
    });
  }

  private async buildIgnoreGlobs(cancellationToken?: vscode.CancellationToken): Promise<string[]> {
    const ignores = await vscode.workspace.findFiles(
      "**/.gitignore",
      "**/node_modules/**",
      undefined,
      cancellationToken,
    );
    const ignoreGlobs = new Set(["**/node_modules/**"]);

    for (const ignore of ignores) {
      try {
        const content = await fs.readFile(ignore.fsPath, { encoding: "utf8" });
        const lines = content
          .split("\n")
          .map(line => line.trim())
          .filter(line => line && !line.startsWith("#"));

        const cwd = path.relative(this.workspaceFolder.uri.fsPath, path.dirname(ignore.fsPath));

        for (const line of lines) {
          if (!cwd || cwd === "" || cwd === ".") {
            ignoreGlobs.add(line.trim());
          } else {
            ignoreGlobs.add(path.join(cwd.trim(), line.trim()));
          }
        }
      } catch (err) {
        output.appendLine(`Error reading .gitignore file at ${ignore.fsPath}: ${err}`);
      }
    }

    return [...ignoreGlobs.values()];
  }

  private createFileTestItems(files: vscode.Uri[]): void {
    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      let fileTestItem = this.testController.items.get(windowsVscodeUri(file.fsPath));
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

      const existing = this.testController.items.get(windowsVscodeUri(uri.fsPath));
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
      const existing = this.testController.items.get(windowsVscodeUri(uri.fsPath));
      if (existing) {
        existing.children.replace([]);
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
    if (!targetPath) {
      return;
    }

    try {
      const fileContent = await fs.readFile(targetPath, "utf8");
      const testNodes = this.parseTestBlocks(fileContent);

      const fileUri = vscode.Uri.file(windowsVscodeUri(targetPath));
      let fileTestItem = testItem || this.testController.items.get(windowsVscodeUri(targetPath));
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
      output.appendLine(`Error reading test file at ${targetPath}: ${err}`);
    }
  }

  private parseTestBlocks(fileContent: string): TestNode[] {
    const cleanContent = fileContent
      .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n\r]/g, " "))
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

    const arrayString = eachMatch[1].replace(/,\s*(?=[\]\}])/g, "");

    try {
      const eachValues = JSON.parse(arrayString);
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
    } catch (error) {
      output.appendLine(`Error parsing .each test values at index ${index}: ${error}`);
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
    this.currentRun = run;

    token.onCancellationRequested(() => {
      run.end();
      this.closeAllActiveProcesses();
      this.disconnectInspector();
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

    try {
      await this.runTestsWithInspector(queue, run, token);
    } catch (error) {
      output.appendLine(`Error running tests: ${error}`);
      for (const test of queue) {
        run.errored(test, new vscode.TestMessage(`Error: ${error}`));
      }
    } finally {
      run.end();
      this.currentRun = null;
    }
  }

  private async runTestsWithInspector(
    tests: vscode.TestItem[],
    run: vscode.TestRun,
    token: vscode.CancellationToken,
  ): Promise<void> {
    // Clean up any previous inspector connection
    this.disconnectInspector();

    // Group tests by file for multi-file support
    const testsByFile = new Map<string, vscode.TestItem[]>();
    const allFiles = new Set<string>();

    for (const test of tests) {
      if (!test.uri) continue;

      const filePath = windowsVscodeUri(test.uri.fsPath);
      allFiles.add(filePath);

      if (!testsByFile.has(filePath)) {
        testsByFile.set(filePath, []);
      }
      testsByFile.get(filePath)?.push(test);
      run.enqueued(test);
    }

    // Create signal socket for Bun notification
    let signal: UnixSignal | TCPSocketSignal;

    if (process.platform === "win32") {
      signal = new TCPSocketSignal(await getAvailablePort());
    } else {
      signal = new UnixSignal();
    }

    let inspectorUrl: string | null = null;
    let ws: any = null;

    // Setup signal listener for when Bun connects
    signal.on("Signal.received", async () => {
      output.appendLine("Received signal from Bun - inspector connection established");

      // Connect to the inspector if we found the URL
      if (inspectorUrl && !ws) {
        this.connectToInspector(inspectorUrl, run);
      }
    });

    const { bunCommand, testArgs } = this.getBunExecutionConfig();
    const args = ["--inspect-wait", ...testArgs, ...Array.from(allFiles)];

    run.appendOutput(`\r\n\x1b[34m>\x1b[0m \x1b[2m${bunCommand} ${args.join(" ")}\x1b[0m\r\n\r\n`);

    const proc = spawn(bunCommand, args, {
      cwd: this.workspaceFolder.uri.fsPath,
      env: {
        ...process.env,
        BUN_INSPECT_NOTIFY: signal.url,
        BUN_DEBUG_QUIET_LOGS: "1",
        FORCE_COLOR: "1",
        NO_COLOR: "0",
      },
    });

    this.activeProcesses.add(proc);

    proc.stdout?.on("data", data => {
      const dataStr = data.toString();
      output.appendLine(`STDOUT: ${dataStr}`);
      const formattedOutput = dataStr.replace(/\n/g, "\r\n");
      run.appendOutput(formattedOutput);
    });

    proc.stderr?.on("data", data => {
      const dataStr = data.toString();
      output.appendLine(`STDERR: ${dataStr}`);
      const formattedOutput = dataStr.replace(/\n/g, "\r\n");
      run.appendOutput(formattedOutput);

      // Look for the inspector URL in stderr
      if (dataStr.includes("ws://")) {
        const match = dataStr.match(/ws:\/\/[^\s]+/);
        if (match && match[0]) {
          inspectorUrl = match[0];
          output.appendLine(`Found inspector URL: ${inspectorUrl}`);

          // Connect to the inspector immediately
          this.connectToInspector(match[0], run);
        }
      }
    });

    // Mark all tests as started
    for (const test of tests) {
      run.started(test);
      output.appendLine(`Started test: ${test.label}`);
    }

    // Wait for the process to complete or timeout
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        proc.on("close", code => {
          this.activeProcesses.delete(proc);
          output.appendLine(`Process closed with code: ${code}`);
          if (code === 0 || code === 1) {
            resolve();
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });

        proc.on("error", error => {
          this.activeProcesses.delete(proc);
          output.appendLine(`Process error: ${error.message}`);
          reject(error);
        });
      }),
      new Promise<void>(resolve => {
        // Give it 30 seconds to run tests
        setTimeout(() => {
          output.appendLine("Test execution timeout reached");
          resolve();
        }, 30000);
      }),
    ]);

    // Cleanup
    signal.close();
    if (ws) {
      ws.close();
    }
    this.disconnectInspector();

    // Force kill the process if it's still running
    if (this.activeProcesses.has(proc)) {
      output.appendLine("Force killing Bun process");
      proc.kill("SIGKILL");
      this.activeProcesses.delete(proc);
    }
  }

  private connectToInspector(url: string, run: vscode.TestRun): void {
    if (this.inspectorConnection) {
      return; // Already connected
    }

    output.appendLine(`Connecting to Bun inspector at: ${url}`);

    const WebSocket = require("ws");
    const ws = new WebSocket(url, {
      headers: {
        "Ref-Event-Loop": "0",
      },
    });

    ws.on("open", () => {
      output.appendLine("✅ Connected to Bun inspector!");

      // Send initialization
      output.appendLine("📤 Sending initialization...");
      ws.send(
        JSON.stringify({
          id: 0,
          method: "Inspector.initialize",
          params: {
            adapterID: "bun-test-inspector",
            enableControlFlowProfiler: false,
            enableLifecycleAgentReporter: true,
            enableDebugger: false,
            sendImmediatePreventExit: false,
          },
        }),
      );
    });

    ws.on("message", (data: any) => {
      try {
        const message = JSON.parse(data.toString());
        output.appendLine(`📥 Received message: ${JSON.stringify(message, null, 2)}`);

        // Handle initialization response
        if (message.id === 0 && message.result) {
          output.appendLine("🎯 Inspector initialized!");

          // Enable domains
          ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
          ws.send(JSON.stringify({ id: 2, method: "TestReporter.enable" }));
          ws.send(JSON.stringify({ id: 3, method: "LifecycleReporter.enable" }));
        }

        // Handle responses
        if (message.id && message.result !== undefined) {
          output.appendLine(`✅ Response for ID ${message.id}: ${JSON.stringify(message.result)}`);
        }

        // Handle test events
        if (message.method && message.method.startsWith("TestReporter.")) {
          output.appendLine(`🎯 TEST EVENT: ${message.method}`);
          this.handleInspectorMessage(message, run);
        }

        if (message.method && message.method.startsWith("LifecycleReporter.")) {
          output.appendLine(`🔥 LIFECYCLE EVENT: ${message.method}`);
          this.handleInspectorMessage(message, run);
        }
      } catch (error) {
        output.appendLine(`❌ Failed to parse message: ${data.toString()}`);
      }
    });

    ws.on("close", () => {
      output.appendLine("🔌 WebSocket connection closed");
      this.inspectorConnection = null;
    });

    ws.on("error", (error: Error) => {
      output.appendLine(`❌ WebSocket error: ${error.message}`);
      this.inspectorConnection = null;
    });

    // Store the connection (as a simple flag)
    this.inspectorConnection = ws as any;
  }

  private handleInspectorMessage(message: InspectorMessage, run: vscode.TestRun): void {
    // Log ALL messages for comprehensive debugging
    output.appendLine(`Inspector message: ${JSON.stringify(message, null, 2)}`);

    if (!message.method) {
      if (message.id) {
        output.appendLine(`Response for request ID ${message.id}`);
      }
      return;
    }

    if (!message.params) {
      output.appendLine(`No params for method: ${message.method}`);
      return;
    }

    output.appendLine(`Handling inspector event: ${message.method}`);
    output.appendLine(`Event params: ${JSON.stringify(message.params, null, 2)}`);

    switch (message.method) {
      case "TestReporter.found":
        output.appendLine("🎯 GOT TestReporter.found EVENT!");
        this.handleTestFound(message.params as TestFoundEvent);
        break;

      case "TestReporter.start":
        output.appendLine("🚀 GOT TestReporter.start EVENT!");
        this.handleTestStart(message.params as TestStartEvent, run);
        break;

      case "TestReporter.end":
        output.appendLine("✅ GOT TestReporter.end EVENT!");
        this.handleTestEnd(message.params as TestEndEvent, run);
        break;

      case "LifecycleReporter.error":
        output.appendLine("🔥 GOT LifecycleReporter.error EVENT!");
        this.handleLifecycleError(message.params as LifecycleErrorEvent, run);
        break;

      default:
        output.appendLine(`❓ Unknown inspector method: ${message.method}`);
        break;
    }
  }

  private handleTestFound(params: any): void {
    output.appendLine(`Test found raw params: ${JSON.stringify(params)}`);

    // Parameters are sent as object: {id, url, line, name, type, parentId}
    if (params && typeof params === "object" && params.id && params.name && params.url) {
      const { id: testId, url: sourceURL, line, name, type, parentId } = params;
      output.appendLine(
        `Parsed test: ${name} (ID: ${testId}) at ${sourceURL}:${line} type: ${type} parentId: ${parentId}`,
      );

      // Store the mapping of test ID to test info for later use
      const testItem = this.findTestItemByName(name, sourceURL);
      if (testItem) {
        this.testIdToVSCodeTest.set(testId, testItem);
      }
      this.lastTestId = Math.max(this.lastTestId, testId);
    } else {
      output.appendLine(`Invalid test found params format: ${JSON.stringify(params)}`);
    }
  }

  private handleTestStart(params: any, run: vscode.TestRun): void {
    output.appendLine(`Test start raw params: ${JSON.stringify(params)}`);

    // Parameters are sent as object: {id}
    if (params && typeof params === "object" && params.id) {
      const { id: testId } = params;
      const testItem = this.testIdToVSCodeTest.get(testId);
      if (testItem) {
        run.started(testItem);
        output.appendLine(`Test started: ${testItem.label} (ID: ${testId})`);
      } else {
        output.appendLine(`Test started but no test item found for ID: ${testId}`);
      }
    } else {
      output.appendLine(`Invalid test start params format: ${JSON.stringify(params)}`);
    }
  }

  private handleTestEnd(params: any, run: vscode.TestRun): void {
    output.appendLine(`Test end raw params: ${JSON.stringify(params)}`);

    // Parameters are sent as object: {id, status, elapsed}
    if (
      params &&
      typeof params === "object" &&
      params.id &&
      params.status !== undefined &&
      params.elapsed !== undefined
    ) {
      const { id: testId, status, elapsed } = params;
      const testItem = this.testIdToVSCodeTest.get(testId);
      if (!testItem) {
        output.appendLine(`Test ended but no test item found for ID: ${testId}`);
        return;
      }

      const duration = elapsed / 1000; // Convert microseconds to milliseconds

      switch (status) {
        case "pass":
          run.passed(testItem, duration);
          break;
        case "fail":
          run.failed(testItem, new vscode.TestMessage("Test failed (see output for details)"), duration);
          break;
        case "timeout":
          run.failed(testItem, new vscode.TestMessage("Test timed out"), duration);
          break;
        case "skip":
          run.skipped(testItem);
          break;
        case "todo":
          run.skipped(testItem);
          break;
      }

      output.appendLine(`Test ended: ${testItem.label} (ID: ${testId}) - ${status}`);
    } else {
      output.appendLine(`Invalid test end params format: ${JSON.stringify(params)}`);
    }
  }

  private handleLifecycleError(params: any, run: vscode.TestRun): void {
    output.appendLine(`Lifecycle error raw params: ${JSON.stringify(params)}`);

    // Parameters are sent as object: {message, name, urls, lineColumns, sourceLines}
    if (params && typeof params === "object" && params.message) {
      const { message, name, urls, lineColumns, sourceLines } = params;
      output.appendLine(`Lifecycle error: ${message}`);

      // Try to associate the error with a test
      // Use the "last test ID" approach as suggested
      const testId = this.lastTestId;
      const testItem = this.testIdToVSCodeTest.get(testId);

      if (testItem && urls && urls.length > 0 && lineColumns && lineColumns.length >= 2) {
        const url = urls[0];
        const line = lineColumns[0];
        const column = lineColumns[1];

        const vscodeMessage = new vscode.TestMessage(message);

        try {
          const location = new vscode.Location(
            vscode.Uri.file(url),
            new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1)),
          );
          vscodeMessage.location = location;
        } catch (error) {
          // If we can't create location, just use the message as-is
        }

        run.failed(testItem, vscodeMessage);
      } else {
        // If we can't associate with a specific test, create a generic error
        output.appendLine(`Could not associate error with specific test`);

        // Try to find a test by URL if possible
        if (urls && urls.length > 0) {
          const fileUrl = urls[0];
          const testItem = this.findTestItemByUrl(fileUrl);
          if (testItem) {
            const vscodeMessage = new vscode.TestMessage(message);
            if (lineColumns && lineColumns.length >= 2) {
              try {
                const location = new vscode.Location(
                  vscode.Uri.file(fileUrl),
                  new vscode.Position(Math.max(0, lineColumns[0] - 1), Math.max(0, lineColumns[1] - 1)),
                );
                vscodeMessage.location = location;
              } catch (error) {
                // If we can't create location, just use the message as-is
              }
            }
            run.failed(testItem, vscodeMessage);
          }
        }
      }
    } else {
      output.appendLine(`Invalid lifecycle error params format: ${JSON.stringify(params)}`);
    }
  }

  private findTestItemByName(name: string, url: string): vscode.TestItem | undefined {
    // Try to find the test item by name and file path
    for (const [, fileItem] of this.testController.items) {
      if (fileItem.uri && fileItem.uri.fsPath === url) {
        // Search through the test item hierarchy
        const found = this.searchTestItemRecursive(fileItem, name);
        if (found) return found;
      }
    }

    return undefined;
  }

  private searchTestItemRecursive(item: vscode.TestItem, name: string): vscode.TestItem | undefined {
    if (item.label === name) {
      return item;
    }

    for (const [, child] of item.children) {
      const found = this.searchTestItemRecursive(child, name);
      if (found) return found;
    }

    return undefined;
  }

  private findTestItemByUrl(url: string): vscode.TestItem | undefined {
    for (const [, fileItem] of this.testController.items) {
      if (fileItem.uri && fileItem.uri.fsPath === url) {
        return fileItem;
      }
    }
    return undefined;
  }

  private disconnectInspector(): void {
    if (this.inspectorConnection) {
      this.inspectorConnection.close();
      this.inspectorConnection = null;
    }
    this.testIdToVSCodeTest.clear();
    this.lastTestId = 0;
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

    if (isFileOnly) {
      args.push("--inspect-brk");
    } else {
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
          testNames.push(`^ ${t} `);
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
        args.push("--test-name-pattern", process.platform === "win32" ? `""` : testNamesRegex);
      }
    }

    output.appendLine(`Debugging command: "${bunCommand} ${args.join(" ")}"`);

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
      const res = await vscode.debug.startDebugging(this.workspaceFolder, debugConfiguration);
      if (!res) throw new Error("Failed to start debugging session");
    } catch (error) {
      for (const test of tests) {
        run.errored(test, new vscode.TestMessage(`Error starting debugger: ${error}`));
      }
      output.appendLine(`Error starting debugger: ${error}`);
    }
    run.end();
  }

  private closeAllActiveProcesses(): void {
    for (const p of this.activeProcesses) {
      p.kill();
    }
    this.activeProcesses.clear();
  }

  public dispose(): void {
    this.closeAllActiveProcesses();
    this.disconnectInspector();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}

function windowsVscodeUri(uri: string): string {
  return process.platform === "win32" ? uri.replace("c:\\", "C:\\") : uri;
}
