import * as os from "node:os";
import * as vscode from "vscode";
import {
  decodeSerializedError,
  type BundlerMessage,
  type DeserializedFailure,
} from "../../../../../src/bake/client/error-serialization";
import { DataViewReader } from "../../../../../src/bake/client/reader";
import {
  DebugAdapter,
  getAvailablePort,
  getRandomId,
  TCPSocketSignal,
  UnixSignal,
} from "../../../../bun-debug-adapter-protocol";
import { SourceMap } from "../../../../bun-debug-adapter-protocol/src/debugger/sourcemap";
import type { JSC } from "../../../../bun-inspector-protocol";
import { ReconnectingWebSocket } from "./ws";

// Types
interface OriginalPosition {
  originalLine: number;
  originalColumn: number;
}

interface TextPosition {
  line: number;
  column: number;
}

interface WSClient {
  socket: ReconnectingWebSocket;
  disposable: { dispose(): void };
}

// Diagnostic Parsing
function parseDiagnostics(view: DataView): Map<number, DeserializedFailure> {
  const reader = new DataViewReader(view, 1);
  const errors = new Map<number, DeserializedFailure>();

  const removedCount = reader.u32();
  for (let i = 0; i < removedCount; i++) {
    errors.delete(reader.u32());
  }

  while (reader.hasMoreData()) {
    const owner = reader.u32();
    const file = reader.string32() || null;
    const messageCount = reader.u32();
    const messages = Array.from({ length: messageCount }, () => decodeSerializedError(reader)) as BundlerMessage[];
    errors.set(owner, { file, messages });
  }

  return errors;
}

// Source Position Utilities
function findOriginalLineAndColumn(runtimeObjects: JSC.Runtime.RemoteObject[]): OriginalPosition | null {
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

function byteOffsetToPosition(text: string, offset: number): TextPosition {
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

// Coverage Reporting
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

    await this.reportCoverage(adapter, event, uri, transpiledOffsetToOriginalPosition);
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

// Debug Adapter Setup
async function setupDebugAdapter(
  signal: UnixSignal | TCPSocketSignal,
  url: string,
  coverageReporter: CoverageReporter,
  diagnosticCollection: vscode.DiagnosticCollection,
) {
  coverageReporter.clearDecorations();
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

function setupEnvironmentVariables(
  context: vscode.ExtensionContext,
  url: string,
  signal: UnixSignal | TCPSocketSignal,
) {
  context.environmentVariableCollection.append("BUN_INSPECT", `${url}?wait=1`);
  context.environmentVariableCollection.append("BUN_INSPECT_NOTIFY", signal.url);
  context.environmentVariableCollection.append("BUN_HIDE_INSPECTOR_MESSAGE", "1");
}

function setupDisposables(context: vscode.ExtensionContext, signal: UnixSignal | TCPSocketSignal) {
  context.subscriptions.push({
    dispose() {
      signal.close();
    },
  });
}

// Main Extension Registration
export async function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("BunDiagnostics");
  const coverageReporter = new CoverageReporter(diagnosticCollection);

  context.subscriptions.push(diagnosticCollection);

  const signal = os.platform() !== "win32" ? new UnixSignal() : new TCPSocketSignal(await getAvailablePort());

  const url = `ws://127.0.0.1:${await getAvailablePort()}/${getRandomId()}`;

  signal.on("Signal.received", () => setupDebugAdapter(signal, url, coverageReporter, diagnosticCollection));

  setupEnvironmentVariables(context, url, signal);
  setupDisposables(context, signal);
}
