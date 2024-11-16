import * as os from "node:os";
import * as vscode from "vscode";
import {
  DebugAdapter,
  getAvailablePort,
  getRandomId,
  TCPSocketSignal,
  UnixSignal,
} from "../../../../bun-debug-adapter-protocol";
import { SourceMap } from "../../../../bun-debug-adapter-protocol/src/debugger/sourcemap";
import type { JSC } from "../../../../bun-inspector-protocol";

function findOriginalLineAndColumn(runtimeObjects: JSC.Runtime.RemoteObject[]) {
  for (const obj of runtimeObjects) {
    if (obj.type !== "object" || obj.subtype !== "error" || !obj.preview?.properties) continue;

    const properties = obj.preview.properties;
    const originalLine = properties.find(prop => prop.name === "originalLine" && prop.type === "number")?.value;
    const originalColumn = properties.find(prop => prop.name === "originalColumn" && prop.type === "number")?.value;

    if (originalLine !== undefined && originalColumn !== undefined) {
      return {
        originalLine: parseInt(originalLine, 10),
        originalColumn: parseInt(originalColumn, 10),
      };
    }
  }

  return null;
}

function byteOffsetToPosition(text: string, offset: number) {
  const lines = text.split("\n");
  let remainingOffset = offset;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;

    if (remainingOffset <= lineLength) {
      return { line: i, column: remainingOffset };
    }

    remainingOffset -= lineLength + 1;
  }

  return { line: lines.length - 1, column: lines[lines.length - 1].length };
}

class EditorStateManager {
  private decorations = new Set<vscode.TextEditorDecorationType>();
  private diagnosticCollection: vscode.DiagnosticCollection;

  public constructor(diagnosticCollection: vscode.DiagnosticCollection) {
    this.diagnosticCollection = diagnosticCollection;
  }

  clearDecorations() {
    for (const decoration of this.decorations) {
      decoration.dispose();
    }

    this.decorations.clear();
  }

  clearDiagnostics() {
    this.diagnosticCollection.clear();
  }

  clearAll() {
    this.clearDecorations();
    this.clearDiagnostics();
  }

  addDecoration(decoration: vscode.TextEditorDecorationType) {
    this.decorations.add(decoration);
  }

  setDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic) {
    this.diagnosticCollection.set(uri, [diagnostic]);
  }

  dispose() {
    this.clearAll();
  }
}

class CoverageReporter {
  private coverageIntervalMap = new Map<string, NodeJS.Timer>();
  private executionCounts = new Map<string, number>();
  private editorState: EditorStateManager;

  constructor(editorState: EditorStateManager) {
    this.editorState = editorState;
  }

  clearIntervals() {
    for (const interval of this.coverageIntervalMap.values()) {
      clearInterval(interval);
    }
    this.coverageIntervalMap.clear();
  }

  async createCoverageReportingTimer(
    adapter: DebugAdapter,
    event: JSC.Debugger.ScriptParsedEvent,
    scriptSource: string,
    sourceMapURL: string | undefined,
  ) {
    const existingTimer = this.coverageIntervalMap.get(event.scriptId);
    if (existingTimer) clearInterval(existingTimer);

    const map = sourceMapURL ? SourceMap(sourceMapURL) : null;
    const uri = vscode.Uri.file(event.url);

    const report = () => {
      return this.reportCoverage(adapter, event, uri, (offset: number) => {
        if (map) {
          const { line, column } = byteOffsetToPosition(scriptSource, offset);
          const original = map.originalLocation({ line, column });
          return new vscode.Position(original.line, original.column);
        } else {
          const { line, column } = byteOffsetToPosition(scriptSource, offset);
          return new vscode.Position(line, column);
        }
      });
    };

    const timer = setInterval(report, 1000);
    this.coverageIntervalMap.set(event.scriptId, timer);

    await report();
  }

  private async reportCoverage(
    adapter: DebugAdapter,
    event: JSC.Debugger.ScriptParsedEvent,
    uri: vscode.Uri,
    transpiledOffsetToOriginalPosition: (offset: number) => vscode.Position,
  ) {
    const response = await adapter
      .send("Runtime.getBasicBlocks", {
        sourceID: event.scriptId,
      })
      .catch(() => null);

    if (!response) return;

    this.editorState.clearAll();

    for (const block of response.basicBlocks) {
      if (!block.hasExecuted) continue;

      const start = transpiledOffsetToOriginalPosition(block.startOffset);
      const end = transpiledOffsetToOriginalPosition(block.endOffset);

      if (end.character === uri.fsPath.length) continue;

      const rangeKey = `${event.scriptId}:${block.startOffset}-${block.endOffset}`;
      const currentCount = (this.executionCounts.get(rangeKey) ?? 0) + 1;
      this.executionCounts.set(rangeKey, currentCount);

      if (currentCount > 2) {
        const range = new vscode.Range(start, end);
        const decorationType = vscode.window.createTextEditorDecorationType({
          backgroundColor: "rgba(255, 0, 0, 0.05)",
        });

        const editor = vscode.window.visibleTextEditors.find(
          editor => editor.document.uri.toString() === uri.toString(),
        );

        if (editor) {
          editor.setDecorations(decorationType, [{ range }]);
          this.editorState.addDecoration(decorationType);
        }
      }
    }
  }

  dispose() {
    this.clearIntervals();
    this.executionCounts.clear();
  }
}

class BunDiagnosticsManager {
  private editorState: EditorStateManager;
  private signal: UnixSignal | TCPSocketSignal;
  private urlBunShouldListenOn: string;
  private context: vscode.ExtensionContext;

  public get signalUrl() {
    return this.signal.url;
  }

  public get bunInspectUrl() {
    return this.urlBunShouldListenOn;
  }

  public static async initialize(context: vscode.ExtensionContext) {
    const urlBunShouldListenOn = `ws://127.0.0.1:${await getAvailablePort()}/${getRandomId()}`;
    const signal = os.platform() !== "win32" ? new UnixSignal() : new TCPSocketSignal(await getAvailablePort());

    return new BunDiagnosticsManager(context, {
      urlBunShouldListenOn,
      signal,
    });
  }

  /**
   * Called when Bun pings BUN_INSPECT_NOTIFY (indicating a program has started).
   */
  private async handleNewConnection() {
    // Clear all diagnostics and decorations so the editor is clean
    this.editorState.clearAll();

    await this.setupDebugAdapter(new DebugAdapter(), new CoverageReporter(this.editorState));
  }

  private async setupDebugAdapter(debugAdapter: DebugAdapter, coverageReporter: CoverageReporter) {
    debugAdapter.on("Debugger.scriptParsed", async event => {
      await this.handleScriptParsed(debugAdapter, event, coverageReporter);
    });

    debugAdapter.on("Console.messageAdded", params => {
      this.handleConsoleMessage(params);
    });

    const dispose = () => {
      debugAdapter.close();
      debugAdapter.removeAllListeners();
      coverageReporter.dispose();
    };

    this.signal.once("Signal.closed", dispose);
    this.context.subscriptions.push({ dispose });

    const ok = await debugAdapter.start(this.urlBunShouldListenOn);
    if (!ok) {
      await vscode.window.showErrorMessage("Failed to start Bun debug adapter");
      return;
    }

    debugAdapter.initialize({
      adapterID: "bun-vsc-terminal-debug-adapter",
      enableControlFlowProfiler: true,
    });
  }

  private async handleScriptParsed(
    debugAdapter: DebugAdapter,
    event: JSC.Debugger.ScriptParsedEvent,
    coverageReporter: CoverageReporter,
  ) {
    const { scriptSource } = await debugAdapter.send("Debugger.getScriptSource", {
      scriptId: event.scriptId,
    });

    await coverageReporter.createCoverageReportingTimer(debugAdapter, event, scriptSource, event.sourceMapURL);
  }

  private handleConsoleMessage(params: JSC.Console.MessageAddedEvent) {
    if (!params.message.parameters || !params.message.url) return;

    const lineAndCol = findOriginalLineAndColumn(params.message.parameters);
    if (!lineAndCol) return;

    const uri = vscode.Uri.file(params.message.url);
    const range = new vscode.Range(
      new vscode.Position(lineAndCol.originalLine - 1, lineAndCol.originalColumn - 1),
      new vscode.Position(lineAndCol.originalLine - 1, lineAndCol.originalColumn),
    );

    const diagnostic = new vscode.Diagnostic(range, params.message.text, vscode.DiagnosticSeverity.Error);
    this.editorState.setDiagnostic(uri, diagnostic);
  }

  private constructor(
    context: vscode.ExtensionContext,
    options: {
      urlBunShouldListenOn: string;
      signal: UnixSignal | TCPSocketSignal;
    },
  ) {
    this.urlBunShouldListenOn = options.urlBunShouldListenOn;
    this.signal = options.signal;
    this.editorState = new EditorStateManager(vscode.languages.createDiagnosticCollection("BunDiagnostics"));
    this.context = context;

    this.signal.on("Signal.received", () => this.handleNewConnection());

    context.subscriptions.push(this.editorState, {
      dispose: () => {
        this.signal.close();
        this.signal.removeAllListeners();
      },
    });
  }
}

export async function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  const manager = await BunDiagnosticsManager.initialize(context);

  context.environmentVariableCollection.append("BUN_INSPECT", `${manager.bunInspectUrl}?wait=1`);
  context.environmentVariableCollection.append("BUN_INSPECT_NOTIFY", manager.signalUrl);
  context.environmentVariableCollection.append("BUN_HIDE_INSPECTOR_MESSAGE", "1");
}
