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
  private disposables: vscode.Disposable[] = [];

  public constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("BunDiagnostics");

    this.disposables.push(
      // When user is typing we should clear the decorations
      vscode.workspace.onDidChangeTextDocument(e => {
        if (this.decorations.size !== 0) {
          this.clearDecorationsForUri(e.document.uri);
        }
      }),
    );
  }

  clearDecorationsForUri(uri: vscode.Uri) {
    const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());

    if (editor) {
      for (const decoration of this.decorations) {
        editor.setDecorations(decoration, []);
      }
    }
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
    this.disposables.forEach(d => d.dispose());
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

  private cleanupStaleExecutionCounts(scriptId: string) {
    for (const key of this.executionCounts.keys()) {
      if (key.startsWith(`${scriptId}:`)) {
        this.executionCounts.delete(key);
      }
    }
  }

  async createCoverageReportingTimer(
    adapter: DebugAdapter,
    event: JSC.Debugger.ScriptParsedEvent,
    scriptSource: string,
    sourceMapURL: string | undefined,
  ) {
    const existingTimer = this.coverageIntervalMap.get(event.scriptId);
    if (existingTimer) {
      clearInterval(existingTimer);
      this.cleanupStaleExecutionCounts(event.scriptId);
    }

    // TODO: Move source map handling to nativeland
    const map = sourceMapURL ? SourceMap(sourceMapURL) : null;
    const uri = vscode.Uri.file(event.url);

    const offsetToPos = (offset: number) => {
      if (map) {
        const { line, column } = byteOffsetToPosition(scriptSource, offset);
        const original = map.originalLocation({ line, column });
        return new vscode.Position(original.line, original.column);
      } else {
        const { line, column } = byteOffsetToPosition(scriptSource, offset);
        return new vscode.Position(line, column);
      }
    };

    const report = () => {
      return this.reportCoverage(adapter, event, uri, offsetToPos);
    };

    await report();
    const timer = setInterval(report, 1000);
    this.coverageIntervalMap.set(event.scriptId, timer);
  }

  private async reportCoverage(
    adapter: DebugAdapter,
    event: JSC.Debugger.ScriptParsedEvent,
    uri: vscode.Uri,
    transpiledOffsetToOriginalPosition: (offset: number) => vscode.Position,
  ) {
    const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());

    if (!editor) {
      return;
    }

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
      const currentCount = (this.executionCounts.get(rangeKey) ?? 1) + 1;
      this.executionCounts.set(rangeKey, currentCount);

      if (currentCount > 2) {
        const range = new vscode.Range(start, end);
        const decorationType = vscode.window.createTextEditorDecorationType({
          backgroundColor: "rgba(79, 250, 123, 0.08)",
        });

        editor.setDecorations(decorationType, [{ range }]);
        this.editorState.addDecoration(decorationType);
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
  private async handleSignalReceived() {
    // Clear all diagnostics and decorations so the editor is clean
    this.editorState.clearAll();

    const debugAdapter = new DebugAdapter();
    const coverageReporter = new CoverageReporter(this.editorState);

    debugAdapter.on("Debugger.scriptParsed", async event => {
      await this.handleScriptParsed(debugAdapter, event, coverageReporter);
    });

    debugAdapter.on("Inspector.event", async event => {
      console.log(JSON.stringify(event.method));
    });

    debugAdapter.on("LifecycleReporter.error", event => this.handleLifecycleError(event));

    const dispose = async () => {
      debugAdapter.removeAllListeners();
      await debugAdapter.send("LifecycleReporter.stopPreventingExit");
      debugAdapter.close();
      coverageReporter.dispose();
    };

    this.signal.once("Signal.closed", dispose);

    // might as well push it to the subscriptions array
    // in case the user restarts extension host or something lol
    this.context.subscriptions.push({ dispose });

    const ok = await debugAdapter.start(this.urlBunShouldListenOn);
    if (!ok) {
      await vscode.window.showErrorMessage("Failed to start Bun debug adapter");
      return;
    }

    debugAdapter.initialize({
      adapterID: "bun-vsc-terminal-debug-adapter",
      enableControlFlowProfiler: true,
      enableLifecycleAgentReporter: true,
      sendImmediatePreventExit: true,
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

  private handleLifecycleError(params: JSC.LifecycleReporter.ErrorEvent) {
    // params.lineColumns is flat pairs of line and columns from each stack frame, we only care about the first one
    const [line = null, column = null] = params.lineColumns;

    if (line === null || column === null) {
      return;
    }

    // params.urls is the url from each stack frame, and again we only care about the first one
    const url = params.urls[0];
    if (!url) {
      return;
    }

    const uri = vscode.Uri.file(url);
    const range = new vscode.Range(new vscode.Position(line - 1, column - 1), new vscode.Position(line - 1, column));

    const diagnostic = new vscode.Diagnostic(range, params.message, vscode.DiagnosticSeverity.Error);
    this.editorState.setDiagnostic(uri, diagnostic);
  }

  public dispose() {
    return vscode.Disposable.from(this.editorState, {
      dispose: () => {
        this.signal.off("Signal.received", this.handleSignalReceived);
        this.signal.close();
        this.signal.removeAllListeners();
      },
    });
  }

  private constructor(
    context: vscode.ExtensionContext,
    options: {
      urlBunShouldListenOn: string;
      signal: UnixSignal | TCPSocketSignal;
    },
  ) {
    this.urlBunShouldListenOn = options.urlBunShouldListenOn;
    this.editorState = new EditorStateManager();
    this.signal = options.signal;
    this.context = context;

    this.handleSignalReceived = this.handleSignalReceived.bind(this);

    this.signal.on("Signal.received", this.handleSignalReceived);
  }
}

export async function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  const manager = await BunDiagnosticsManager.initialize(context);

  context.environmentVariableCollection.append("BUN_INSPECT", `${manager.bunInspectUrl}?wait=1`);
  context.environmentVariableCollection.append("BUN_INSPECT_NOTIFY", manager.signalUrl);

  context.subscriptions.push(manager);
}
