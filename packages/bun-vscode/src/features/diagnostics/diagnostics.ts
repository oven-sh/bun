import * as fs from "node:fs/promises";
import { Socket } from "node:net";
import * as os from "node:os";
import { inspect } from "node:util";
import * as vscode from "vscode";
import {
  getAvailablePort,
  NodeSocketDebugAdapter,
  TCPSocketSignal,
  UnixSignal,
} from "../../../../bun-debug-adapter-protocol";
import type { JSC } from "../../../../bun-inspector-protocol";
import { typedGlobalState } from "../../global-state";
import { getConfig } from "../../extension";

const output = vscode.window.createOutputChannel("Bun - Diagnostics");

const ansiRegex = (() => {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const pattern = [
    `[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?${ST})`,
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  ].join("|");

  return new RegExp(pattern, "g");
})();

function stripAnsi(str: string) {
  return str.replace(ansiRegex, "");
}

class EditorStateManager {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  public constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("BunDiagnostics");
  }

  getVisibleEditorsWithErrors() {
    return vscode.window.visibleTextEditors.filter(editor => {
      const diagnostics = this.diagnosticCollection.get(editor.document.uri);

      return diagnostics && diagnostics.length > 0;
    });
  }

  clearInFile(uri: vscode.Uri) {
    if (this.diagnosticCollection.has(uri)) {
      output.appendLine(`Clearing diagnostics for ${uri.toString()}`);
      this.diagnosticCollection.delete(uri);
    }
  }

  clearAll(reason: string) {
    output.appendLine("Clearing all because: " + reason);
    this.diagnosticCollection.clear();
  }

  set(uri: vscode.Uri, diagnostic: vscode.Diagnostic) {
    this.diagnosticCollection.set(uri, [diagnostic]);
  }

  dispose() {
    this.clearAll("Editor state was disposed");
    this.disposables.forEach(d => d.dispose());
  }
}

class BunDiagnosticsManager {
  private readonly editorState: EditorStateManager;
  private readonly signal: UnixSignal | TCPSocketSignal;
  private readonly context: vscode.ExtensionContext;

  public get signalUrl() {
    return this.signal.url;
  }

  private static async getOrRecreateSignal(context: vscode.ExtensionContext) {
    const globalState = typedGlobalState(context.globalState);
    const existing = globalState.get("BUN_INSPECT_CONNECT_TO");

    const isWin = os.platform() === "win32";

    if (existing) {
      if (existing.type === "unix") {
        output.appendLine(`Reusing existing unix socket: ${existing.url}`);

        if ("url" in existing) {
          await fs.unlink(existing.url).catch(() => {
            // ? lol
          });
        }

        return new UnixSignal(existing.url);
      } else {
        output.appendLine(`Reusing existing tcp socket on: ${existing.port}`);
        return new TCPSocketSignal(existing.port);
      }
    }

    if (isWin) {
      const port = await getAvailablePort();

      await globalState.update("BUN_INSPECT_CONNECT_TO", {
        type: "tcp",
        port,
      });

      output.appendLine(`Created new tcp socket on: ${port}`);

      return new TCPSocketSignal(port);
    } else {
      const signal = new UnixSignal();

      await globalState.update("BUN_INSPECT_CONNECT_TO", {
        type: "unix",
        url: signal.url,
      });

      output.appendLine(`Created new unix socket: ${signal.url}`);

      return signal;
    }
  }

  // private static getOrCreateOldVersionInspectURL = createGlobalStateGenerationFn(
  //   "DIAGNOSTICS_BUN_INSPECT",
  //   async () => {
  //     const url =
  //       process.platform === "win32"
  //         ? `ws://127.0.0.1:${await getAvailablePort()}/${getRandomId()}`
  //         : `ws+unix://${os.tmpdir()}/${getRandomId()}.sock`;

  //     return url;
  //   },
  // );

  public static async initialize(context: vscode.ExtensionContext) {
    const signal = await BunDiagnosticsManager.getOrRecreateSignal(context);

    return new BunDiagnosticsManager(context, signal);
  }

  /**
   * Called when Bun pings BUN_INSPECT_NOTIFY (indicating a program has started).
   */
  private async handleSocketConnection(socket: Socket) {
    const debugAdapter = new NodeSocketDebugAdapter(socket);

    this.editorState.clearAll("A new socket connected");

    debugAdapter.on("LifecycleReporter.reload", async () => {
      this.editorState.clearAll("LifecycleReporter reported a reload event");
    });

    debugAdapter.on("Inspector.event", e => {
      output.appendLine(`Received inspector event: ${e.method}`);
    });

    debugAdapter.on("Inspector.error", e => {
      output.appendLine(inspect(e, true, null));
    });

    debugAdapter.on("LifecycleReporter.error", event => this.handleLifecycleError(event));

    const ok = await debugAdapter.start();

    if (!ok) {
      await vscode.window.showErrorMessage("Failed to start debug adapter");
      debugAdapter.removeAllListeners();

      return;
    }

    debugAdapter.initialize({
      adapterID: "bun-vsc-terminal-debug-adapter",
      enableControlFlowProfiler: false,
      enableLifecycleAgentReporter: true,
      sendImmediatePreventExit: false,
      enableDebugger: false, // Performance overhead when debugger is enabled
    });
  }

  private handleLifecycleError(event: JSC.LifecycleReporter.ErrorEvent) {
    const message = stripAnsi(event.message).trim() || event.name || "Error";

    output.appendLine(
      `Received error event: '{name:${event.name}} ${message.split("\n")[0].trim().substring(0, 100)}'`,
    );

    const [url = null] = event.urls;
    const [line = null, col = null] = event.lineColumns;

    if (url === null || url.length === 0 || line === null || col === null) {
      output.appendLine("No valid url or line/column found in error event");
      output.appendLine(JSON.stringify(event));
      return;
    }

    const uri = vscode.Uri.file(url);

    // range is really just 1 character here..
    const range = new vscode.Range(new vscode.Position(line - 1, col - 1), new vscode.Position(line - 1, col));

    const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());

    // ...but we want to highlight the entire word after(inclusive) the character
    const rangeOfWord = document?.getWordRangeAtPosition(range.start) ?? range; // Fallback to just the character if no editor or no word range is found

    const diagnostic = new vscode.Diagnostic(rangeOfWord, message, vscode.DiagnosticSeverity.Error);

    diagnostic.source = "Bun";

    const relatedInformation = event.urls.flatMap((url, i) => {
      if (i === 0 || url === "") {
        return [];
      }

      const [line = null, col = null] = event.lineColumns.slice(i * 2, i * 2 + 2);

      if (line === null || col === null) {
        return [];
      }

      return [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(vscode.Uri.file(url), new vscode.Position(line - 1, col - 1)),
          message,
        ),
      ];
    });

    diagnostic.relatedInformation = relatedInformation;

    this.editorState.set(uri, diagnostic);
  }

  public dispose() {
    return vscode.Disposable.from(this.editorState, {
      dispose: () => {
        this.signal.close();
        this.signal.removeAllListeners();
      },
    });
  }

  private constructor(context: vscode.ExtensionContext, signal: UnixSignal | TCPSocketSignal) {
    this.editorState = new EditorStateManager();
    this.signal = signal;
    this.context = context;

    this.context.subscriptions.push(
      // on did type
      vscode.workspace.onDidChangeTextDocument(e => {
        this.editorState.clearInFile(e.document.uri);
      }),
    );

    this.signal.on("Signal.Socket.connect", this.handleSocketConnection.bind(this));
  }
}

const description = new vscode.MarkdownString(
  "Bun's VSCode extension communicates with Bun over a socket. We set the url in your terminal with the `BUN_INSPECT_NOTIFY` environment variable",
);

export async function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  context.environmentVariableCollection.clear();
  context.environmentVariableCollection.description = description;

  if (!getConfig("diagnosticsSocket.enabled")) return;

  const manager = await BunDiagnosticsManager.initialize(context);

  context.environmentVariableCollection.replace("BUN_INSPECT_CONNECT_TO", manager.signalUrl);

  context.subscriptions.push(manager);
}
