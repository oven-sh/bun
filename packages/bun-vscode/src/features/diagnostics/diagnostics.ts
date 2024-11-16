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

class CoverageReporter {
  private decorations = new Set<vscode.TextEditorDecorationType>();
  private diagnosticCollection: vscode.DiagnosticCollection;
  private coverageIntervalMap = new Map<string, NodeJS.Timer>();

  constructor(diagnosticCollection: vscode.DiagnosticCollection) {
    this.diagnosticCollection = diagnosticCollection;
  }

  clearDecorations() {
    for (const decoration of this.decorations) {
      decoration.dispose();
    }

    this.decorations.clear();
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
    sourceMapURL: string,
  ) {
    const existingTimer = this.coverageIntervalMap.get(event.scriptId);
    if (existingTimer) clearInterval(existingTimer);

    const map = SourceMap(sourceMapURL);
    const uri = vscode.Uri.file(event.url);

    const transpiledOffsetToOriginalPosition = (offset: number): vscode.Position => {
      const { line, column } = byteOffsetToPosition(scriptSource, offset);
      const original = map.originalLocation({ line, column });
      return new vscode.Position(original.line, original.column);
    };

    const timer = setInterval(() => this.reportCoverage(adapter, event, uri, transpiledOffsetToOriginalPosition), 1000);

    this.coverageIntervalMap.set(event.scriptId, timer);
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

    this.diagnosticCollection.clear();
    this.clearDecorations();

    const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
    if (!editor) return;

    for (const block of response.basicBlocks) {
      if (!block.hasExecuted) continue;

      const start = transpiledOffsetToOriginalPosition(block.startOffset);
      const end = transpiledOffsetToOriginalPosition(block.endOffset);

      if (end.character === editor.document.getText().length) continue;

      const range = new vscode.Range(start, end);
      const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: "rgba(255, 0, 0, 0.1)",
      });

      editor.setDecorations(decorationType, [{ range }]);
      this.decorations.add(decorationType);
    }
  }
}

async function setupDebugAdapter(
  signal: UnixSignal | TCPSocketSignal,
  url: string,
  coverageReporter: CoverageReporter,
  diagnosticCollection: vscode.DiagnosticCollection,
) {
  const adapter = new DebugAdapter();

  adapter.on("Debugger.scriptParsed", async event => {
    const { scriptSource } = await adapter.send("Debugger.getScriptSource", {
      scriptId: event.scriptId,
    });

    if (!event.sourceMapURL) return;

    await coverageReporter.createCoverageReportingTimer(adapter, event, scriptSource, event.sourceMapURL);
  });

  adapter.on("Console.messageAdded", params => {
    if (!params.message.parameters || !params.message.url) return;

    const lineAndCol = findOriginalLineAndColumn(params.message.parameters);
    if (!lineAndCol) return;

    const uri = vscode.Uri.file(params.message.url);
    const range = new vscode.Range(
      new vscode.Position(lineAndCol.originalLine - 1, lineAndCol.originalColumn - 1),
      new vscode.Position(lineAndCol.originalLine - 1, lineAndCol.originalColumn),
    );

    const diagnostic = new vscode.Diagnostic(range, params.message.text, vscode.DiagnosticSeverity.Error);
    diagnosticCollection.set(uri, [diagnostic]);
  });

  signal.once("Signal.closed", () => {
    adapter.close();
    adapter.removeAllListeners();
    coverageReporter.clearIntervals();
  });

  const ok = await adapter.start(url);
  if (!ok) {
    await vscode.window.showErrorMessage("Failed to start Bun debug adapter");
    return;
  }

  adapter.initialize({
    adapterID: "bun-vsc-terminal-debug-adapter",
    enableControlFlowProfiler: true,
  });
}

export async function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("BunDiagnostics");
  const coverageReporter = new CoverageReporter(diagnosticCollection);

  context.subscriptions.push(diagnosticCollection);

  // The url that Bun's inspector should listen on
  const urlBunShouldListenOn = `ws://127.0.0.1:${await getAvailablePort()}/${getRandomId()}`;

  const signal = os.platform() !== "win32" ? new UnixSignal() : new TCPSocketSignal(await getAvailablePort());

  signal.on("Signal.received", async () => {
    // On new connection from Bun, clear all decorations and setup the debug adapter
    coverageReporter.clearDecorations();
    await setupDebugAdapter(signal, urlBunShouldListenOn, coverageReporter, diagnosticCollection);
  });

  context.environmentVariableCollection.append("BUN_INSPECT", `${urlBunShouldListenOn}?wait=1`);
  context.environmentVariableCollection.append("BUN_INSPECT_NOTIFY", signal.url);
  context.environmentVariableCollection.append("BUN_HIDE_INSPECTOR_MESSAGE", "1");

  context.subscriptions.push({
    dispose() {
      signal.close();
    },
  });
}
