import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import * as net from "node:net";
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
  status: "pass" | "fail" | "timeout" | "skip" | "todo" | "skipped_because_label";
  elapsed: number;
}

interface LifecycleErrorEvent {
  message: string;
  name: string;
  urls: string[];
  lineColumns: number[];
  sourceLines: string[];
}

const enum FramerState {
  WaitingForLength,
  WaitingForMessage,
}

class SocketFramer {
  private state: FramerState = FramerState.WaitingForLength;
  private pendingLength: number = 0;
  private sizeBuffer: Buffer = Buffer.alloc(4);
  private sizeBufferIndex: number = 0;
  private bufferedData: Buffer = Buffer.alloc(0);
  private static messageLengthBuffer: Buffer = Buffer.alloc(4);

  constructor(private onMessage: (message: string) => void) {
    this.reset();
  }

  reset(): void {
    this.state = FramerState.WaitingForLength;
    this.bufferedData = Buffer.alloc(0);
    this.sizeBufferIndex = 0;
    this.sizeBuffer = Buffer.alloc(4);
  }

  send(socket: net.Socket, data: string): void {
    SocketFramer.messageLengthBuffer.writeUInt32BE(Buffer.byteLength(data), 0);
    socket.write(SocketFramer.messageLengthBuffer as unknown as Uint8Array);
    socket.write(data);
  }

  onData(data: Buffer): void {
    this.bufferedData = this.bufferedData.length > 0 ? Buffer.concat([this.bufferedData, data]) : data;

    const messagesToDeliver: string[] = [];

    while (this.bufferedData.length > 0) {
      if (this.state === FramerState.WaitingForLength) {
        if (this.sizeBufferIndex + this.bufferedData.length < 4) {
          const remainingBytes = Math.min(4 - this.sizeBufferIndex, this.bufferedData.length);
          this.bufferedData.copy(this.sizeBuffer, this.sizeBufferIndex, 0, remainingBytes);
          this.sizeBufferIndex += remainingBytes;
          this.bufferedData = this.bufferedData.slice(remainingBytes);
          break;
        }

        const remainingBytes = 4 - this.sizeBufferIndex;
        this.bufferedData.copy(this.sizeBuffer, this.sizeBufferIndex, 0, remainingBytes);
        this.pendingLength = this.sizeBuffer.readUInt32BE(0);

        this.state = FramerState.WaitingForMessage;
        this.sizeBufferIndex = 0;
        this.bufferedData = this.bufferedData.slice(remainingBytes);
      }

      if (this.bufferedData.length < this.pendingLength) {
        break;
      }

      const message = this.bufferedData.toString("utf-8", 0, this.pendingLength);
      this.bufferedData = this.bufferedData.slice(this.pendingLength);
      this.state = FramerState.WaitingForLength;
      this.pendingLength = 0;
      this.sizeBufferIndex = 0;
      messagesToDeliver.push(message);
    }

    for (const message of messagesToDeliver) {
      this.onMessage(message);
    }
  }
}

class InspectorConnection {
  private socket: net.Socket | null = null;
  private framer: SocketFramer | null = null;
  private requestId = 1;
  private connected = false;

  constructor(private onMessage: (message: InspectorMessage) => void) {}

  async connect(socketPath: string): Promise<void> {
    output.appendLine(`Connecting to inspector at ${socketPath}`);

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.framer = new SocketFramer((message: string) => {
        try {
          const parsedMessage = JSON.parse(message) as InspectorMessage;
          this.onMessage(parsedMessage);
        } catch (error) {
          output.appendLine(`Failed to parse inspector message: ${message}`);
        }
      });

      this.socket.connect(socketPath, () => {
        this.connected = true;
        output.appendLine(`Inspector connected to ${socketPath}`);
        resolve();
      });

      this.socket.on("data", (data: Buffer) => {
        this.framer?.onData(data);
      });

      this.socket.on("error", (error: Error) => {
        output.appendLine(`Inspector connection error: ${error.message}`);
        reject(error);
      });

      this.socket.on("close", () => {
        this.connected = false;
        output.appendLine("Inspector connection closed");
      });
    });
  }

  send(method: string, params?: any): void {
    if (!this.connected || !this.socket || !this.framer) {
      throw new Error("Inspector not connected");
    }

    const id = this.requestId++;
    const message = { id, method, params };

    output.appendLine(`Inspector sending: ${method}`);
    this.framer.send(this.socket, JSON.stringify(message));
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.framer = null;
  }
}

export class BunTestController implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private activeProcesses: Set<ChildProcess> = new Set();
  private inspectorConnection: InspectorConnection | null = null;
  private testIdToVSCodeTest = new Map<number, vscode.TestItem>();
  private lastTestId = 0;
  private currentRun: vscode.TestRun | null = null;
  private foundTestItems: Set<string> | null = null;
  private inspectorTestHierarchy = new Map<number, { name: string; parentId: number; path: string }>();
  private fileTestCounts = new Map<
    string,
    { failed: number; skipped: number; passed: number; total: number; completed: number }
  >();

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
    // Static analysis for initial discovery - good backup for new files
    this.testController.resolveHandler = async testItem => {
      if (!testItem) return;
      return this.staticDiscoverTests(testItem);
    };

    this.testController.refreshHandler = async token => {
      const files = await this.discoverInitialTests(token);
      if (!files) return;

      // Clear existing file items that no longer exist
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
        fileTestItem.canResolveChildren = true; // Keep static analysis as backup
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

    // Track which test items are actually found by inspector
    this.foundTestItems = new Set<string>();

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

    // Create Unix domain socket for inspector with more unique path
    const socketPath = path.join(
      tmpdir(),
      `bun-inspector-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.sock`,
    );

    const { bunCommand, testArgs } = this.getBunExecutionConfig();
    let args = [`--inspect-wait=unix://${socketPath}`, ...testArgs, ...Array.from(allFiles)];

    // Add test name pattern if we're running specific tests (not all tests)
    if (this.shouldUseTestNamePattern(tests)) {
      const pattern = this.buildTestNamePattern(tests);
      if (pattern) {
        args.push("--test-name-pattern", process.platform === "win32" ? `"${pattern}"` : pattern);
      }
    }

    run.appendOutput(`\r\n\x1b[34m>\x1b[0m \x1b[2m${bunCommand} ${args.join(" ")}\x1b[0m\r\n\r\n`);

    let server: net.Server | null = null;
    try {
      // Create inspector server FIRST and wait for it to be ready
      server = await this.createInspectorServer(socketPath, run);
      output.appendLine("✅ Inspector server created successfully");

      // Small delay to ensure server is fully ready
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      output.appendLine(`❌ Inspector server creation failed: ${error}`);
      throw error;
    }

    // Now spawn the process
    const proc = spawn(bunCommand, args, {
      cwd: this.workspaceFolder.uri.fsPath,
      env: {
        ...process.env,
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

          // Give a moment for any remaining inspector events to process
          setTimeout(() => {
            if (code === 0 || code === 1) {
              resolve();
            } else {
              reject(new Error(`Process exited with code ${code}`));
            }
          }, 500); // Wait 500ms for final events
        });

        proc.on("error", error => {
          this.activeProcesses.delete(proc);
          output.appendLine(`Process error: ${error.message}`);
          reject(error);
        });
      }),
      new Promise<void>(resolve => {
        // Give it 60 seconds to run tests (increased for multiple files)
        setTimeout(() => {
          output.appendLine("Test execution timeout reached");
          resolve();
        }, 60000);
      }),
    ]);

    // Cleanup with proper sequencing
    output.appendLine("🧹 Starting cleanup...");

    // Prune test items that weren't found by inspector
    this.pruneUnfoundTestItems(Array.from(allFiles));

    // Force kill the process if it's still running
    if (this.activeProcesses.has(proc)) {
      output.appendLine("Force killing Bun process");
      proc.kill("SIGKILL");
      this.activeProcesses.delete(proc);
    }

    // Give a moment for cleanup, then close server
    setTimeout(() => {
      this.disconnectInspector();
      if (server) {
        server.close(() => {
          output.appendLine("🔌 Inspector server closed");
        });
      }
    }, 100);
  }

  private async createInspectorServer(socketPath: string, run: vscode.TestRun): Promise<net.Server> {
    return new Promise((resolve, reject) => {
      const server = net.createServer(socket => {
        output.appendLine("✅ Bun connected to inspector socket");

        const framer = new SocketFramer((message: string) => {
          try {
            const parsedMessage = JSON.parse(message) as InspectorMessage;
            output.appendLine(`📥 Received: ${parsedMessage.method || "response"}`);
            this.handleInspectorMessage(parsedMessage, run);
          } catch (error) {
            output.appendLine(`Failed to parse inspector message: ${message}`);
          }
        });

        this.inspectorConnection = new InspectorConnection(() => {});
        (this.inspectorConnection as any).socket = socket;
        (this.inspectorConnection as any).framer = framer;

        socket.on("data", (data: Buffer) => {
          framer.onData(data);
        });

        socket.on("close", () => {
          output.appendLine("🔌 Inspector socket closed");
          this.inspectorConnection = null;
        });

        socket.on("error", (error: Error) => {
          output.appendLine(`❌ Inspector socket error: ${error.message}`);
        });

        // Initialize inspector immediately after connection - no delay
        output.appendLine("📤 Initializing inspector...");
        framer.send(socket, JSON.stringify({ id: 1, method: "Inspector.initialized" }));
        framer.send(socket, JSON.stringify({ id: 2, method: "Runtime.enable" }));
        framer.send(socket, JSON.stringify({ id: 3, method: "TestReporter.enable" }));
        framer.send(socket, JSON.stringify({ id: 4, method: "LifecycleReporter.enable" }));

        // Keep the connection alive
        socket.setKeepAlive(true, 1000);
        socket.setNoDelay(true);
      });

      server.listen(socketPath, () => {
        output.appendLine(`Inspector server listening on ${socketPath}`);
        resolve(server);
      });

      server.on("error", error => {
        output.appendLine(`Inspector server error: ${error}`);
        reject(error);
      });
    });
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
      output.appendLine(`Parsed test: ${name} (ID: ${testId}) at ${sourceURL}:${line} type:${type} parent:${parentId}`);

      // Use consistent ID system: file path + test name path (not numeric ID)
      const testItem = this.createOrUpdateTestItemFromFound(testId, sourceURL, line, name, type, parentId);
      if (testItem) {
        this.testIdToVSCodeTest.set(testId, testItem);
        // Track this test item as found by inspector
        if (this.currentRun) {
          this.foundTestItems?.add(testItem.id);

          // Initialize file test counts if this is a test (not describe block)
          if (type !== "describe") {
            this.initializeFileTestCount(sourceURL);
          }
        }
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
          // Don't create error message here - let lifecycle reporter handle it
          // Only set failed status, the actual error will come from lifecycle events
          run.failed(testItem, new vscode.TestMessage("Test failed"), duration);
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
        case "skipped_because_label":
          // Do nothing - this test wasn't requested to run due to test name pattern filtering
          break;
      }

      // Update file-level test counts (only for actual tests, not describe blocks)
      if (testItem.tags.some(tag => tag.id === "test") && testItem.uri) {
        this.updateFileTestCount(testItem.uri.fsPath, status);
      }

      output.appendLine(`Test ended: ${testItem.label} (ID: ${testId}) - ${status}`);
    } else {
      output.appendLine(`Invalid test end params format: ${JSON.stringify(params)}`);
    }
  }

  private handleLifecycleError(params: any, run: vscode.TestRun): void {
    output.appendLine(`🔥 Lifecycle error raw params: ${JSON.stringify(params)}`);

    // Parameters are sent as object: {message, name, urls, lineColumns, sourceLines}
    if (params && typeof params === "object" && params.message) {
      const { message, name, urls, lineColumns, sourceLines } = params;

      // Strip ANSI colors from message for better parsing
      const cleanMessage = this.stripAnsiColors(message);
      output.appendLine(`📝 Raw message: ${message}`);
      output.appendLine(`🧹 Clean message: ${cleanMessage}`);
      output.appendLine(`📍 URLs: ${JSON.stringify(urls)}`);
      output.appendLine(`📐 Line/columns: ${JSON.stringify(lineColumns)}`);
      output.appendLine(`📄 Source lines: ${JSON.stringify(sourceLines)}`);

      // Only report error if we don't already have a failed test
      // Check if the last test already failed to avoid double reporting
      const testId = this.lastTestId;
      const testItem = this.testIdToVSCodeTest.get(testId);

      if (testItem && urls && urls.length > 0 && lineColumns && lineColumns.length >= 2) {
        // Only report error for actual test items, not describe blocks
        const isTestItem = testItem.tags.some(tag => tag.id === "test");
        if (!isTestItem) {
          output.appendLine(`⏭️  Skipping error for describe block: ${testItem.label}`);
          return;
        }

        output.appendLine(`🎯 Processing error for test: ${testItem.label}`);

        // Use prettified error message with clean message
        const prettifiedMessage = this.createTestMessage({
          testResult: { message: cleanMessage },
          testItem,
          lifecycleError: { urls, lineColumns, sourceLines },
        });

        if (prettifiedMessage) {
          output.appendLine(`✨ Using prettified message`);
          run.failed(testItem, prettifiedMessage);
        } else {
          output.appendLine(`⚠️  Falling back to simple message`);
          // Fallback to simple message with direct location from lifecycle error
          const url = urls[0];
          const line = lineColumns[0];
          const column = lineColumns[1];

          const vscodeMessage = new vscode.TestMessage(cleanMessage);

          try {
            const location = new vscode.Location(
              vscode.Uri.file(url),
              new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1)),
            );
            vscodeMessage.location = location;
            output.appendLine(`📍 Set location to ${url}:${line}:${column}`);
          } catch (error) {
            output.appendLine(`❌ Failed to create location: ${error}`);
          }

          run.failed(testItem, vscodeMessage);
        }
      } else {
        output.appendLine(
          `❌ Missing required data - testItem: ${!!testItem}, urls: ${urls?.length}, lineColumns: ${lineColumns?.length}`,
        );
      }
    } else {
      output.appendLine(`❌ Invalid lifecycle error params format: ${JSON.stringify(params)}`);
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

  private createOrUpdateTestItemFromFound(
    testId: number,
    sourceURL: string,
    line: number,
    name: string,
    type: string,
    parentId: number,
  ): vscode.TestItem | undefined {
    const fileUri = vscode.Uri.file(windowsVscodeUri(sourceURL));

    // Ensure file test item exists
    let fileTestItem = this.testController.items.get(fileUri.toString());
    if (!fileTestItem) {
      fileTestItem = this.testController.createTestItem(
        fileUri.toString(),
        path.relative(this.workspaceFolder.uri.fsPath, sourceURL),
        fileUri,
      );
      fileTestItem.canResolveChildren = true; // Keep static analysis as backup
      this.testController.items.add(fileTestItem);
    }

    // Build consistent test path like static analysis does
    const testPath = this.buildTestPath(testId, name, parentId);
    const testItemId = `${sourceURL}#${testPath}`;

    // Check if this test item already exists from static analysis
    const existingItem = this.findTestItemById(testItemId);
    if (existingItem) {
      // Update existing item with inspector info
      if (line > 0) {
        existingItem.range = new vscode.Range(
          new vscode.Position(line - 1, 0),
          new vscode.Position(line - 1, name.length),
        );
      }
      return existingItem;
    }

    // Create the test item from inspector event - this is what Bun actually found
    const testItem = this.testController.createTestItem(testItemId, name, fileUri);
    testItem.tags = [new vscode.TestTag(type === "describe" ? "describe" : "test")];

    // Set location if available
    if (line > 0) {
      testItem.range = new vscode.Range(new vscode.Position(line - 1, 0), new vscode.Position(line - 1, name.length));
    }

    // Find parent and add to appropriate location
    if (parentId > 0) {
      const parentItem = this.testIdToVSCodeTest.get(parentId);
      if (parentItem) {
        parentItem.children.add(testItem);
      } else {
        // Parent not found yet, add to file for now
        fileTestItem.children.add(testItem);
      }
    } else {
      // Top-level test, add to file
      fileTestItem.children.add(testItem);
    }

    return testItem;
  }

  private findTestItemById(id: string): vscode.TestItem | undefined {
    // Search through all test items to find one with matching ID
    for (const [, fileItem] of this.testController.items) {
      if (fileItem.id === id) {
        return fileItem;
      }
      const found = this.findTestItemByIdRecursive(fileItem, id);
      if (found) return found;
    }
    return undefined;
  }

  private findTestItemByIdRecursive(item: vscode.TestItem, targetId: string): vscode.TestItem | undefined {
    if (item.id === targetId) {
      return item;
    }

    for (const [, child] of item.children) {
      const found = this.findTestItemByIdRecursive(child, targetId);
      if (found) return found;
    }

    return undefined;
  }

  private buildTestPath(testId: number, name: string, parentId: number): string {
    // Store this test in the hierarchy map
    this.inspectorTestHierarchy.set(testId, { name, parentId, path: "" });

    // Build the full path by walking up the hierarchy
    const pathParts: string[] = [];
    let currentId = testId;

    while (currentId > 0) {
      const testInfo = this.inspectorTestHierarchy.get(currentId);
      if (!testInfo) break;

      pathParts.unshift(this.escapeTestName(testInfo.name));
      currentId = testInfo.parentId;
    }

    const fullPath = pathParts.join(" > ");

    // Update the stored path
    const testInfo = this.inspectorTestHierarchy.get(testId);
    if (testInfo) {
      testInfo.path = fullPath;
    }

    return fullPath;
  }

  private pruneUnfoundTestItems(filePaths: string[]): void {
    if (!this.foundTestItems) {
      return;
    }

    output.appendLine(`🧹 Pruning test items. Found ${this.foundTestItems.size} items via inspector.`);

    for (const filePath of filePaths) {
      const fileUri = vscode.Uri.file(windowsVscodeUri(filePath));
      const fileTestItem = this.testController.items.get(fileUri.toString());

      if (fileTestItem) {
        this.pruneTestItemRecursive(fileTestItem);
      }
    }

    // Clear the tracking set
    this.foundTestItems = null;
  }

  private pruneTestItemRecursive(item: vscode.TestItem): void {
    if (!this.foundTestItems) {
      return;
    }

    const childrenToRemove: string[] = [];

    for (const [childId, child] of item.children) {
      if (this.foundTestItems.has(child.id)) {
        // This item was found by inspector, keep it and check its children
        this.pruneTestItemRecursive(child);
      } else {
        // This item was not found by inspector, remove it
        childrenToRemove.push(childId);
      }
    }

    // Remove unfound children
    for (const childId of childrenToRemove) {
      item.children.delete(childId);
      output.appendLine(`🗑️ Pruned test item: ${childId}`);
    }
  }

  private createTestMessage({
    testResult,
    testItem,
    lifecycleError,
  }: {
    testResult: { message?: string };
    testItem: vscode.TestItem;
    lifecycleError?: { urls: string[]; lineColumns: number[]; sourceLines: string[] };
  }): vscode.TestMessage | undefined {
    if (!testResult.message) {
      return undefined;
    }

    output.appendLine(`🔍 Creating test message for: ${testItem.label}`);
    output.appendLine(`📝 Message: ${testResult.message}`);

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
      output.appendLine(`📍 Found stack trace at index ${stackTraceIndex}`);
    } else {
      lines = messageLinesRaw.map(line => line);
      output.appendLine(`❌ No stack trace found`);
    }

    const errorLine = lines[0].trim();
    const messageLines = lines.slice(1, -1).join("\n");
    const fileLine = lines.slice(-1)[0].trim();

    output.appendLine(`🎯 Error line: ${errorLine}`);
    output.appendLine(`📄 Message lines: ${messageLines}`);
    output.appendLine(`📂 File line: ${fileLine}`);

    // Try to get location from lifecycle error first (more accurate)
    let messageLocation: vscode.Location | undefined;
    if (lifecycleError && lifecycleError.urls?.length > 0 && lifecycleError.lineColumns?.length >= 2) {
      try {
        messageLocation = new vscode.Location(
          vscode.Uri.file(lifecycleError.urls[0]),
          new vscode.Position(
            Math.max(0, lifecycleError.lineColumns[0] - 1),
            Math.max(0, lifecycleError.lineColumns[1] - 1),
          ),
        );
        output.appendLine(
          `📍 Using lifecycle error location: ${lifecycleError.urls[0]}:${lifecycleError.lineColumns[0]}:${lifecycleError.lineColumns[1]}`,
        );
      } catch (error) {
        output.appendLine(`❌ Failed to create location from lifecycle error: ${error}`);
      }
    }

    // Fallback to parsing from message
    if (!messageLocation) {
      const filepath = this.getFileLocationFromError(fileLine, testItem.uri?.fsPath || "");
      if (filepath) {
        messageLocation = new vscode.Location(
          vscode.Uri.file(filepath.file),
          new vscode.Position(filepath.line - 1, filepath.column),
        );
        output.appendLine(`📍 Using parsed location: ${filepath.file}:${filepath.line}:${filepath.column}`);
      } else {
        output.appendLine(`❌ No location found, using simple message`);
        return new vscode.TestMessage(testResult.message);
      }
    }

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

  private getFileLocationFromError(
    line: string,
    fallbackPath: string,
  ): { file: string; line: number; column: number } | null {
    const regex = /at\s+.*\s+\((.+):(\d+):(\d+)\)/;
    const match = line.match(regex);
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
      };
    }

    const simpleRegex = /(.+):(\d+):(\d+)/;
    const simpleMatch = line.match(simpleRegex);
    if (simpleMatch) {
      return {
        file: simpleMatch[1],
        line: parseInt(simpleMatch[2], 10),
        column: parseInt(simpleMatch[3], 10),
      };
    }

    return null;
  }

  private initializeFileTestCount(sourceURL: string): void {
    if (!this.fileTestCounts.has(sourceURL)) {
      this.fileTestCounts.set(sourceURL, {
        failed: 0,
        skipped: 0,
        passed: 0,
        total: 0,
        completed: 0,
      });
    }
    const counts = this.fileTestCounts.get(sourceURL)!;
    counts.total++;
  }

  private updateFileTestCount(sourceURL: string, status: string): void {
    const counts = this.fileTestCounts.get(sourceURL);
    if (!counts) return;

    counts.completed++;

    switch (status) {
      case "pass":
        counts.passed++;
        break;
      case "fail":
        counts.failed++;
        break;
      case "skip":
      case "todo":
        counts.skipped++;
        break;
    }

    // Check if all tests in this file are complete
    if (counts.completed >= counts.total) {
      this.setFileTestStatus(sourceURL, counts);
    }
  }

  private setFileTestStatus(
    sourceURL: string,
    counts: { failed: number; skipped: number; passed: number; total: number; completed: number },
  ): void {
    if (!this.currentRun) return;

    const fileUri = vscode.Uri.file(windowsVscodeUri(sourceURL));
    const fileTestItem = this.testController.items.get(fileUri.toString());

    if (!fileTestItem) return;

    if (counts.failed > 0) {
      this.currentRun.failed(fileTestItem, new vscode.TestMessage(`Found ${counts.failed} errors in test results.`));
    } else if (counts.passed > 0) {
      this.currentRun.passed(fileTestItem);
    } else if (counts.skipped > 0) {
      this.currentRun.skipped(fileTestItem);
    }

    output.appendLine(
      `📊 File ${sourceURL} completed: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`,
    );
  }

  private shouldUseTestNamePattern(tests: vscode.TestItem[]): boolean {
    // Use pattern if we have specific tests (not just files)
    return tests.some(test => test.id.includes("#"));
  }

  private getAllTestsInFile(fileItem: vscode.TestItem): vscode.TestItem[] {
    const tests: vscode.TestItem[] = [];

    function collectTests(item: vscode.TestItem) {
      if (item.children.size === 0) {
        tests.push(item);
      } else {
        for (const [, child] of item.children) {
          collectTests(child);
        }
      }
    }

    collectTests(fileItem);
    return tests;
  }

  private buildTestNamePattern(tests: vscode.TestItem[]): string | null {
    const testNames: string[] = [];

    for (const test of tests) {
      // Skip file-level tests that don't have specific test names
      if (!test.id.includes("#")) {
        continue;
      }

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
        testNames.push(`^ ${t} `);
      }
    }

    if (testNames.length === 0) {
      return null;
    }

    return testNames.map(pattern => `(${pattern})`).join("|");
  }

  private disconnectInspector(): void {
    if (this.inspectorConnection) {
      this.inspectorConnection.close();
      this.inspectorConnection = null;
    }
    this.testIdToVSCodeTest.clear();
    this.inspectorTestHierarchy.clear();
    this.fileTestCounts.clear();
    this.lastTestId = 0;
  }

  private stripAnsiColors(str: string): string {
    // Remove ANSI escape sequences
    return str.replace(/\x1b\[[0-9;]*m/g, "");
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
