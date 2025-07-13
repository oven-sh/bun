import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import * as vscode from "vscode";
import type {
  TestNode,
  InspectorMessage,
  TestFoundEvent,
  TestStartEvent,
  TestEndEvent,
  LifecycleErrorEvent,
  TestError,
} from "./types";
import { FramerState } from "./types";

const DEFAULT_TEST_PATTERN = "**/*{.test.,.spec.,_test_,_spec_}{js,ts,tsx,jsx,mts,cts,cjs,mjs}";

export const debug = vscode.window.createOutputChannel("Bun - Test Runner");

class SocketFramer {
  private state: FramerState = FramerState.WaitingForLength;
  private pendingLength: number = 0;
  private sizeBuffer: Uint8Array = new Uint8Array(4);
  private sizeBufferIndex: number = 0;
  private bufferedData: Uint8Array = new Uint8Array(0);
  private static messageLengthBuffer: Uint8Array = new Uint8Array(4);

  constructor(private onMessage: (message: string) => void) {
    this.reset();
  }

  reset(): void {
    this.state = FramerState.WaitingForLength;
    this.bufferedData = new Uint8Array(0);
    this.sizeBufferIndex = 0;
    this.sizeBuffer = new Uint8Array(4);
  }

  send(socket: net.Socket, data: string): void {
    const bytes = Buffer.from(data);
    const view = new DataView(SocketFramer.messageLengthBuffer.buffer);
    view.setUint32(0, bytes.length, false);
    socket.write(SocketFramer.messageLengthBuffer);
    socket.write(data);
  }

  onData(data: Buffer): void {
    const dataArray = new Uint8Array(data);
    const combined = new Uint8Array(this.bufferedData.length + dataArray.length);
    combined.set(this.bufferedData);
    combined.set(dataArray, this.bufferedData.length);
    this.bufferedData = combined;

    const messagesToDeliver: string[] = [];

    while (this.bufferedData.length > 0) {
      if (this.state === FramerState.WaitingForLength) {
        if (this.sizeBufferIndex + this.bufferedData.length < 4) {
          const remainingBytes = Math.min(4 - this.sizeBufferIndex, this.bufferedData.length);
          this.sizeBuffer.set(this.bufferedData.slice(0, remainingBytes), this.sizeBufferIndex);
          this.sizeBufferIndex += remainingBytes;
          this.bufferedData = this.bufferedData.slice(remainingBytes);
          break;
        }

        const remainingBytes = 4 - this.sizeBufferIndex;
        this.sizeBuffer.set(this.bufferedData.slice(0, remainingBytes), this.sizeBufferIndex);
        const view = new DataView(this.sizeBuffer.buffer);
        this.pendingLength = view.getUint32(0, false);

        this.state = FramerState.WaitingForMessage;
        this.sizeBufferIndex = 0;
        this.bufferedData = this.bufferedData.slice(remainingBytes);
      }

      if (this.bufferedData.length < this.pendingLength) {
        break;
      }

      const messageData = this.bufferedData.slice(0, this.pendingLength);
      const message = new TextDecoder().decode(messageData);
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

export class BunTestController implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private activeProcesses: Set<ChildProcess> = new Set();
  private inspectorConnection: InspectorConnection | null = null;

  private inspectorToVSCode = new Map<number, vscode.TestItem>();
  private vscodeToInspector = new Map<string, number>();

  private testErrors = new Map<number, TestError>();
  private lastStartedTestId: number | null = null;

  private testResultHistory = new Map<
    string,
    { status: "passed" | "failed" | "skipped"; message?: vscode.TestMessage; duration?: number }
  >();
  private currentRunType: "file" | "individual" = "file";
  private requestedTestIds: Set<string> = new Set();
  private discoveredTestIds: Set<string> = new Set();

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
      return this.discoverTests(testItem);
    };

    this.testController.refreshHandler = async token => {
      const files = await this.discoverInitialTests(token);
      if (!files?.length) return;

      const filePaths = new Set(files.map(f => f.fsPath));
      for (const [, testItem] of this.testController.items) {
        if (testItem.uri && !filePaths.has(testItem.uri.fsPath)) {
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
    vscode.window.visibleTextEditors.forEach(editor => {
      this.handleOpenDocument(editor.document);
    });

    vscode.workspace.textDocuments.forEach(doc => {
      this.handleOpenDocument(doc);
    });

    vscode.workspace.onDidOpenTextDocument(this.handleOpenDocument.bind(this), null, this.disposables);
  }

  private handleOpenDocument(document: vscode.TextDocument): void {
    if (this.isTestFile(document) && !this.testController.items.get(windowsVscodeUri(document.uri.fsPath))) {
      this.discoverTests(false, windowsVscodeUri(document.uri.fsPath));
    }
  }

  private isTestFile(document: vscode.TextDocument): boolean {
    return document?.uri?.scheme === "file" && /\.(test|spec)\.(js|jsx|ts|tsx|cjs|mts)$/.test(document.uri.fsPath);
  }

  private async discoverInitialTests(cancellationToken?: vscode.CancellationToken): Promise<vscode.Uri[] | undefined> {
    try {
      const tests = await this.findTestFiles(cancellationToken);
      this.createFileTestItems(tests);
      return tests;
    } catch {
      return undefined;
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
      } catch {}
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
        this.discoverTests(existing);
      } else {
        this.discoverTests(false, uri.fsPath);
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

  private async discoverTests(testItem?: vscode.TestItem | false, filePath?: string): Promise<void> {
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
      fileTestItem.canResolveChildren = false;

      this.addTestNodes(testNodes, fileTestItem, targetPath);
    } catch {}
  }

  private parseTestBlocks(fileContent: string): TestNode[] {
    const cleanContent = fileContent
      .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n\r]/g, " "))
      .replace(/\/\/.*$/gm, match => " ".repeat(match.length));

    const testRegex =
      /\b(describe|test|it)(?:\.(?:skip|todo|failing|only))?(?:\.(?:if|todoIf|skipIf)\s*\([^)]*\))?(?:\.each\s*\([^)]*\))?\s*\(\s*(['"`])((?:\\\2|.)*?)\2\s*(?:,|\))/g;

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
    let depth = 0;
    let inString = false;
    let inTemplate = false;
    let stringChar = "";
    let escaped = false;

    for (let i = 0; i < section.length; i++) {
      const char = section[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (!inTemplate && (char === '"' || char === "'")) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (char === "`") {
        inTemplate = !inTemplate;
        continue;
      }

      if (!inString && !inTemplate) {
        if (char === "{") depth++;
        else if (char === "}") depth--;
      }
    }

    return depth;
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

      const testItem = this.testController.createTestItem(testId, this.stripAnsi(node.name), vscode.Uri.file(filePath));

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
      testItem.canResolveChildren = false;
    }
  }

  private stripAnsi(source: string): string {
    return source.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/g, "");
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
      for (const test of queue) {
        run.errored(test, new vscode.TestMessage(`Error: ${error}`));
      }
    } finally {
      run.end();
    }
  }

  private async runTestsWithInspector(
    tests: vscode.TestItem[],
    run: vscode.TestRun,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.disconnectInspector();

    const allFiles = new Set<string>();
    for (const test of tests) {
      if (!test.uri) continue;
      const filePath = windowsVscodeUri(test.uri.fsPath);
      allFiles.add(filePath);
    }

    if (allFiles.size === 0) {
      run.appendOutput("No test files found to run.\n");
      return;
    }

    for (const test of tests) {
      if (test.uri && test.canResolveChildren) {
        await this.discoverTests(test);
      }
    }

    const isIndividualTestRun = this.shouldUseTestNamePattern(tests);
    this.currentRunType = isIndividualTestRun ? "individual" : "file";

    this.requestedTestIds.clear();
    this.discoveredTestIds.clear();
    for (const test of tests) {
      this.requestedTestIds.add(test.id);
    }

    const socketPath = path.join(
      tmpdir(),
      `bun-inspector-${Date.now()}-${Math.random().toString(36).substring(2, 11)}.sock`,
    );

    const { bunCommand, testArgs } = this.getBunExecutionConfig();
    let args = [...testArgs, ...Array.from(allFiles)];

    if (isIndividualTestRun) {
      const pattern = this.buildTestNamePattern(tests);
      if (pattern) {
        args.push("--test-name-pattern", process.platform === "win32" ? `"${pattern}"` : pattern);
      }
    }

    run.appendOutput(`\r\n\x1b[34m>\x1b[0m \x1b[2m${bunCommand} ${args.join(" ")}\x1b[0m\r\n\r\n`);
    args.push(`--inspect-wait=unix://${socketPath}`);

    for (const test of tests) {
      if (isIndividualTestRun || tests.length === 1) {
        run.started(test);
      } else {
        run.enqueued(test);
      }
    }

    let server: net.Server | null = null;
    try {
      server = await this.createInspectorServer(socketPath, run);
    } catch (error) {
      debug.appendLine(`Failed to create inspector server: ${error}`);
      throw error;
    }

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
      const formattedOutput = dataStr.replace(/\n/g, "\r\n");
      run.appendOutput(formattedOutput);
    });

    proc.stderr?.on("data", data => {
      const dataStr = data.toString();
      const formattedOutput = dataStr.replace(/\n/g, "\r\n");
      run.appendOutput(formattedOutput);
    });

    await new Promise<void>((resolve, reject) => {
      proc.on("close", code => {
        this.activeProcesses.delete(proc);
        if (code === 0 || code === 1) {
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      proc.on("error", error => {
        this.activeProcesses.delete(proc);
        reject(error);
      });
    }).finally(() => {
      if (isIndividualTestRun) {
        this.applyPreviousResults(tests, run);
      }

      if (isIndividualTestRun) {
        this.cleanupUndiscoveredTests(tests);
      } else {
        this.cleanupStaleTests(tests);
      }

      if (this.activeProcesses.has(proc)) {
        proc.kill("SIGKILL");
        this.activeProcesses.delete(proc);
      }

      this.disconnectInspector();
      if (server) {
        server.close(() => {});
      }
    });
  }

  private applyPreviousResults(requestedTests: vscode.TestItem[], run: vscode.TestRun): void {
    for (const file of new Set(requestedTests.map(t => t.uri?.toString()).filter(Boolean))) {
      const fileItem = this.testController.items.get(file!);
      if (fileItem) {
        this.applyPreviousResultsToItem(fileItem, run, this.requestedTestIds);
      }
    }
  }

  private applyPreviousResultsToItem(item: vscode.TestItem, run: vscode.TestRun, requestedTestIds: Set<string>): void {
    if (!requestedTestIds.has(item.id)) {
      const previousResult = this.testResultHistory.get(item.id);
      if (previousResult) {
        switch (previousResult.status) {
          case "passed":
            run.passed(item, previousResult.duration);
            break;
          case "failed":
            run.failed(item, previousResult.message || new vscode.TestMessage("Test failed"), previousResult.duration);
            break;
          case "skipped":
            run.skipped(item);
            break;
        }
      }
    }

    for (const [, child] of item.children) {
      this.applyPreviousResultsToItem(child, run, requestedTestIds);
    }
  }

  private async createInspectorServer(socketPath: string, run: vscode.TestRun): Promise<net.Server> {
    return new Promise((resolve, reject) => {
      const server = net.createServer(socket => {
        const framer = new SocketFramer((message: string) => {
          try {
            const parsedMessage = JSON.parse(message) as InspectorMessage;
            this.handleInspectorMessage(parsedMessage, run);
          } catch (error) {
            debug.appendLine(`Failed to parse inspector message: ${error}`);
          }
        });

        this.inspectorConnection = new InspectorConnection(() => {});
        (this.inspectorConnection as any).socket = socket;
        (this.inspectorConnection as any).framer = framer;

        socket.on("data", (data: Buffer) => {
          framer.onData(data);
        });

        socket.on("close", () => {
          this.inspectorConnection = null;
        });

        socket.on("error", () => {});

        framer.send(socket, JSON.stringify({ id: 1, method: "Inspector.initialized" }));
        framer.send(socket, JSON.stringify({ id: 2, method: "Runtime.enable" }));
        framer.send(socket, JSON.stringify({ id: 3, method: "TestReporter.enable" }));
        framer.send(socket, JSON.stringify({ id: 4, method: "LifecycleReporter.enable" }));

        socket.setKeepAlive(true, 1000);
        socket.setNoDelay(true);
      });

      server.listen(socketPath, () => {
        resolve(server);
      });

      server.on("error", reject);
    });
  }

  private handleInspectorMessage(message: InspectorMessage, run: vscode.TestRun): void {
    if (!message.method || !message.params) {
      return;
    }

    switch (message.method) {
      case "TestReporter.found":
        this.handleTestFound(message.params as TestFoundEvent, run);
        break;

      case "TestReporter.start":
        this.handleTestStart(message.params as TestStartEvent, run);
        break;

      case "TestReporter.end":
        this.handleTestEnd(message.params as TestEndEvent, run);
        break;

      case "LifecycleReporter.error":
        this.handleLifecycleError(message.params as LifecycleErrorEvent, run);
        break;
    }
  }

  private handleTestFound(params: TestFoundEvent, _run: vscode.TestRun): void {
    const { id: inspectorTestId, url: sourceURL, name, type, parentId } = params;

    const filePath = windowsVscodeUri(sourceURL);
    let testItem = this.findTestByPath(name, filePath, parentId);

    if (!testItem) {
      testItem = this.createTestItem(name, filePath, type, parentId);
    }

    if (testItem) {
      this.inspectorToVSCode.set(inspectorTestId, testItem);
      this.vscodeToInspector.set(testItem.id, inspectorTestId);
      this.discoveredTestIds.add(testItem.id);
    } else {
      debug.appendLine(`Could not find VS Code test item for: ${name} in ${path.basename(filePath)}`);
    }
  }

  private findTestByPath(testName: string, filePath: string, parentId?: number): vscode.TestItem | undefined {
    const fileUri = vscode.Uri.file(filePath);
    const fileTestItem = this.testController.items.get(fileUri.toString());

    if (!fileTestItem) {
      return undefined;
    }

    let searchRoot = fileTestItem;
    if (parentId !== undefined) {
      const parentItem = this.inspectorToVSCode.get(parentId);
      if (parentItem) {
        searchRoot = parentItem;
      }
    }

    return this.findTestByName(searchRoot, testName);
  }

  private findTestByName(parent: vscode.TestItem, name: string): vscode.TestItem | undefined {
    const strippedName = this.stripAnsi(name);

    for (const [, child] of parent.children) {
      if (child.label === strippedName) {
        return child;
      }
    }

    const escapedName = this.escapeTestName(strippedName);
    for (const [, child] of parent.children) {
      if (child.label === escapedName || this.escapeTestName(child.label) === escapedName) {
        return child;
      }
    }

    for (const [, child] of parent.children) {
      const found = this.findTestByName(child, name);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  private createTestItem(
    name: string,
    filePath: string,
    type: "test" | "describe",
    parentId?: number,
  ): vscode.TestItem | undefined {
    const fileUri = vscode.Uri.file(filePath);

    let fileTestItem = this.testController.items.get(fileUri.toString());
    if (!fileTestItem) {
      fileTestItem = this.testController.createTestItem(
        fileUri.toString(),
        path.relative(this.workspaceFolder.uri.fsPath, filePath) || filePath,
        fileUri,
      );
      this.testController.items.add(fileTestItem);
    }

    let parentItem = fileTestItem;
    if (parentId !== undefined) {
      const parent = this.inspectorToVSCode.get(parentId);
      if (parent) {
        parentItem = parent;
      }
    }

    const parentPath = parentItem === fileTestItem ? "" : parentItem.id.split("#")[1] || "";
    const testPath = parentPath ? `${parentPath} > ${this.escapeTestName(name)}` : this.escapeTestName(name);
    const testId = `${filePath}#${testPath}`;

    const existing = this.findTestByName(parentItem, name);
    if (existing) {
      return existing;
    }

    const testItem = this.testController.createTestItem(testId, this.stripAnsi(name), fileUri);
    testItem.tags = [new vscode.TestTag(type)];
    testItem.canResolveChildren = false;
    parentItem.children.add(testItem);

    return testItem;
  }

  private handleTestStart(params: TestStartEvent, run: vscode.TestRun): void {
    const { id: testId } = params;
    const testItem = this.inspectorToVSCode.get(testId);

    this.lastStartedTestId = testId;

    if (testItem) {
      run.started(testItem);
    }
  }

  private handleTestEnd(params: TestEndEvent, run: vscode.TestRun): void {
    const { id, status, elapsed } = params;
    const testItem = this.inspectorToVSCode.get(id);

    if (!testItem) return;

    const duration = elapsed / 1000000;

    if (
      this.currentRunType === "individual" &&
      status === "skipped_because_label" &&
      !this.requestedTestIds.has(testItem.id)
    ) {
      return;
    }

    switch (status) {
      case "pass":
        run.passed(testItem, duration);
        this.testResultHistory.set(testItem.id, { status: "passed", duration });
        break;
      case "fail":
        const errorInfo = this.testErrors.get(id);
        if (errorInfo) {
          const errorMessage = this.createErrorMessage(errorInfo, testItem);
          run.failed(testItem, errorMessage, duration);
          this.testResultHistory.set(testItem.id, { status: "failed", message: errorMessage, duration });
        } else {
          const message = new vscode.TestMessage(`Test "${testItem.label}" failed - check output for details`);
          run.failed(testItem, message, duration);
          this.testResultHistory.set(testItem.id, { status: "failed", message, duration });
        }
        break;
      case "skip":
      case "todo":
      case "skipped_because_label":
        run.skipped(testItem);
        this.testResultHistory.set(testItem.id, { status: "skipped" });
        break;
      case "timeout":
        const timeoutMsg = new vscode.TestMessage(
          duration > 0 ? `Test timed out after ${duration.toFixed(0)}ms` : "Test timed out",
        );
        run.failed(testItem, timeoutMsg, duration);
        this.testResultHistory.set(testItem.id, { status: "failed", message: timeoutMsg, duration });
        break;
    }
  }

  private handleLifecycleError(params: LifecycleErrorEvent, _run: vscode.TestRun): void {
    const { message, urls, lineColumns } = params;

    if (!urls || urls.length === 0 || !urls[0]) {
      return;
    }

    const filePath = windowsVscodeUri(urls[0]);
    const line = lineColumns && lineColumns.length > 0 ? lineColumns[0] : 1;
    const column = lineColumns && lineColumns.length > 1 ? lineColumns[1] : 1;

    const errorInfo: TestError = {
      message,
      file: filePath,
      line,
      column,
    };

    if (this.lastStartedTestId !== null) {
      this.testErrors.set(this.lastStartedTestId, errorInfo);
    }
  }

  private cleanupUndiscoveredTests(requestedTests: vscode.TestItem[]): void {
    if (this.currentRunType !== "individual" || this.discoveredTestIds.size === 0) {
      return;
    }

    const filesToCheck = new Set<string>();
    for (const test of requestedTests) {
      if (test.uri) {
        filesToCheck.add(test.uri.toString());
      }
    }

    for (const fileUri of filesToCheck) {
      const fileItem = this.testController.items.get(fileUri);
      if (fileItem) {
        this.cleanupTestItem(fileItem);
      }
    }
  }

  private cleanupTestItem(item: vscode.TestItem): void {
    const childrenToRemove: vscode.TestItem[] = [];

    for (const [, child] of item.children) {
      if (!this.discoveredTestIds.has(child.id)) {
        childrenToRemove.push(child);
      } else {
        this.cleanupTestItem(child);
      }
    }

    for (const child of childrenToRemove) {
      item.children.delete(child.id);
    }
  }

  private cleanupStaleTests(requestedTests: vscode.TestItem[]): void {
    if (this.discoveredTestIds.size === 0) {
      return;
    }

    const filesToCheck = new Set<string>();
    for (const test of requestedTests) {
      if (test.uri) {
        filesToCheck.add(test.uri.toString());
      }
    }

    for (const fileUri of filesToCheck) {
      const fileItem = this.testController.items.get(fileUri);
      if (fileItem) {
        const hasTestsInThisFile = Array.from(this.discoveredTestIds).some(id =>
          id.startsWith(fileItem.uri?.fsPath || ""),
        );
        if (hasTestsInThisFile) {
          this.cleanupTestItem(fileItem);
        }
      }
    }
  }

  private createErrorMessage(errorInfo: TestError, _testItem: vscode.TestItem): vscode.TestMessage {
    const cleanMessage = errorInfo.message.replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRFZcf-nqry=><]/g,
      "",
    );

    const errorMessage = this.processErrorData(
      cleanMessage,
      new vscode.Location(
        vscode.Uri.file(errorInfo.file),
        new vscode.Position(errorInfo.line - 1, errorInfo.column - 1),
      ),
    );
    return errorMessage;
  }

  private processErrorData(message: string, location: vscode.Location): vscode.TestMessage {
    const messageLinesRaw = message.split("\n");
    const lines = messageLinesRaw;

    const errorLine = lines[0].trim();
    const messageLines = lines.slice(1).join("\n");

    const errorType = errorLine.replace(/^(E|e)rror: /, "").trim();

    switch (errorType) {
      case "expect(received).toMatchInlineSnapshot(expected)":
      case "expect(received).toMatchSnapshot(expected)":
      case "expect(received).toEqual(expected)":
      case "expect(received).toBe(expected)": {
        const regex = /^Expected:\s*([\s\S]*?)\nReceived:\s*([\s\S]*?)$/;
        let testMessage = vscode.TestMessage.diff(
          errorLine,
          messageLines.match(regex)?.[1].trim() || "",
          messageLines.match(regex)?.[2].trim() || "",
        );
        if (!messageLines.match(regex)) {
          const code = messageLines
            .replace(/(?:\r?\n)+(- Expected\s+- \d+|\+ Received\s+\+ \d+)\s*$/g, "")
            .replace(/(?:\r?\n)+(- Expected\s+- \d+|\+ Received\s+\+ \d+)\s*$/g, "")
            .trim();
          testMessage = new vscode.TestMessage(
            new vscode.MarkdownString("Values did not match:\n").appendCodeblock(code, "diff"),
          );
        }
        testMessage.location = location;
        return testMessage;
      }

      case "expect(received).toBeInstanceOf(expected)": {
        const regex = /^Expected constructor:\s*([\s\S]*?)\nReceived value:\s*([\s\S]*?)$/;
        let testMessage = vscode.TestMessage.diff(
          errorLine,
          messageLines.match(regex)?.[1].trim() || "",
          messageLines.match(regex)?.[2].trim() || "",
        );
        if (!messageLines.match(regex)) {
          testMessage = new vscode.TestMessage(messageLines);
        }
        testMessage.location = location;
        return testMessage;
      }

      case "expect(received).not.toBe(expected)":
      case "expect(received).not.toEqual(expected)": {
        const testMessage = new vscode.TestMessage(messageLines);
        testMessage.location = location;
        return testMessage;
      }

      case "expect(received).toBeNull()": {
        const actualValue = messageLines.replace("Received:", "").trim();
        const testMessage = vscode.TestMessage.diff(errorLine, "null", actualValue);
        testMessage.location = location;
        return testMessage;
      }

      case "expect(received).toMatchObject(expected)": {
        const line = messageLines
          .replace(/(?:\r?\n)+(- Expected\s+- \d+|\+ Received\s+\+ \d+)\s*$/g, "")
          .replace(/(?:\r?\n)+(- Expected\s+- \d+|\+ Received\s+\+ \d+)\s*$/g, "");

        const formatted = new vscode.MarkdownString("Values did not match:");
        formatted.appendCodeblock(line, "diff");
        const testMessage = new vscode.TestMessage(formatted);
        testMessage.location = location;
        return testMessage;
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

    const testMessage = new vscode.TestMessage(msg);
    testMessage.location = location;
    return testMessage;
  }

  private shouldUseTestNamePattern(tests: vscode.TestItem[]): boolean {
    const testUriString = tests[0]?.uri?.toString();
    const testIdEndsWithFileName = tests[0]?.uri && tests[0].label === tests[0].uri.fsPath.split("/").pop();

    const isFileOnly =
      tests.length === 1 &&
      tests[0].uri &&
      (testIdEndsWithFileName || !tests[0].id.includes("#") || tests[0].id === testUriString);

    function hasManyTests() {
      if (tests.length === 0) return false;
      let current = tests[0];
      while (current.parent) {
        if (current.parent.children.size > 1) {
          return true;
        }
        current = current.parent;
      }
      return false;
    }

    return !isFileOnly && hasManyTests();
  }

  private buildTestNamePattern(tests: vscode.TestItem[]): string | null {
    const testNames: string[] = [];

    for (const test of tests) {
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

    return testNames.map(e => `(${e})`).join("|");
  }

  private disconnectInspector(): void {
    if (this.inspectorConnection) {
      this.inspectorConnection.close();
      this.inspectorConnection = null;
    }
    this.inspectorToVSCode.clear();
    this.vscodeToInspector.clear();
    this.requestedTestIds.clear();
  }

  private async debugTests(
    tests: vscode.TestItem[],
    _request: vscode.TestRunRequest,
    run: vscode.TestRun,
  ): Promise<void> {
    const testFiles = new Set<string>();
    for (const test of tests) {
      if (test.uri) {
        testFiles.add(test.uri.fsPath);
      }
    }

    const isIndividualTestRun = this.shouldUseTestNamePattern(tests);

    if (testFiles.size === 0) {
      run.appendOutput("No test files found to debug.\n");
      run.end();
      return;
    }

    const { bunCommand, testArgs } = this.getBunExecutionConfig();
    const args = [...testArgs, ...testFiles];

    if (!isIndividualTestRun) {
      args.push("--inspect-brk");
    } else {
      const breakpoints: vscode.SourceBreakpoint[] = [];
      for (const test of tests) {
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

      const pattern = this.buildTestNamePattern(tests);
      if (pattern) {
        args.push("--test-name-pattern", process.platform === "win32" ? `"${pattern}"` : pattern);
      }
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
      const res = await vscode.debug.startDebugging(this.workspaceFolder, debugConfiguration);
      if (!res) throw new Error("Failed to start debugging session");
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

  public dispose(): void {
    this.closeAllActiveProcesses();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}

class InspectorConnection {
  private socket: net.Socket | null = null;
  private framer: SocketFramer | null = null;
  private requestId = 1;
  private connected = false;

  constructor(private onMessage: (message: InspectorMessage) => void) {}

  async connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.framer = new SocketFramer((message: string) => {
        try {
          const parsedMessage = JSON.parse(message) as InspectorMessage;
          this.onMessage(parsedMessage);
        } catch (error) {
          debug.appendLine(`Failed to parse inspector message: ${message}`);
        }
      });

      this.socket.connect(socketPath, () => {
        this.connected = true;
        resolve();
      });

      this.socket.on("data", (data: Buffer) => {
        this.framer?.onData(data);
      });

      this.socket.on("error", (error: Error) => {
        debug.appendLine(`Inspector connection error: ${error.message}`);
        reject(error);
      });

      this.socket.on("close", () => {
        this.connected = false;
        debug.appendLine("Inspector connection closed");
      });
    });
  }

  send(method: string, params?: any): void {
    if (!this.connected || !this.socket || !this.framer) {
      throw new Error("Inspector not connected");
    }

    const id = this.requestId++;
    const message = { id, method, params };

    debug.appendLine(`Inspector sending: ${method}`);
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

function windowsVscodeUri(uri: string): string {
  return process.platform === "win32" ? uri.replace("c:\\", "C:\\") : uri;
}
