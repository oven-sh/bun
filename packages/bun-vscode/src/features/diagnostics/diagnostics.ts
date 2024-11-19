import { Socket } from "node:net";
import * as os from "node:os";
import * as vscode from "vscode";
import {
  getAvailablePort,
  NodeSocketDebugAdapter,
  TCPSocketSignal,
  UnixSignal,
} from "../../../../bun-debug-adapter-protocol";
import type { JSC } from "../../../../bun-inspector-protocol";

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

  clearDiagnostics() {
    this.diagnosticCollection.clear();
  }

  clearAll() {
    this.clearDiagnostics();
  }

  setDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic) {
    this.diagnosticCollection.set(uri, [diagnostic]);
  }

  dispose() {
    this.clearAll();
    this.disposables.forEach(d => d.dispose());
  }
}

class BunDiagnosticsManager {
  private readonly editorState: EditorStateManager;
  private readonly signal: UnixSignal | TCPSocketSignal;
  private readonly context: vscode.ExtensionContext;

  private knownOpenSockets = new Set<Socket>();

  public get signalUrl() {
    return this.signal.url;
  }

  public static async initialize(context: vscode.ExtensionContext) {
    const signal = os.platform() !== "win32" ? new UnixSignal() : new TCPSocketSignal(await getAvailablePort());

    await signal.ready;

    return new BunDiagnosticsManager(context, signal);
  }

  /**
   * Called when Bun pings BUN_INSPECT_NOTIFY (indicating a program has started).
   */
  private async handleSignalReceived(socket: Socket) {
    const debugAdapter = new NodeSocketDebugAdapter(socket);

    this.knownOpenSockets.add(socket);
    socket.once("close", () => this.knownOpenSockets.delete(socket));

    this.editorState.clearAll();

    debugAdapter.on("LifecycleReporter.reload", async () => {
      this.editorState.clearAll();
    });

    // debugAdapter.on("Inspector.event", async event => {
    //   console.log(event.method);
    // });

    debugAdapter.on("LifecycleReporter.error", event => this.handleLifecycleError(event));

    const dispose = async () => {
      await debugAdapter.send("LifecycleReporter.stopPreventingExit").catch(() => {
        // Probably already exited
      });

      debugAdapter.removeAllListeners();
    };

    const ok = await debugAdapter.start();

    if (!ok) {
      await vscode.window.showErrorMessage("Failed to start debug adapter");
      await dispose();
      return;
    }

    debugAdapter.initialize({
      adapterID: "bun-vsc-terminal-debug-adapter",
      enableControlFlowProfiler: true,
      enableLifecycleAgentReporter: true,
      sendImmediatePreventExit: true,
    });
  }

  private handleLifecycleError(params: JSC.LifecycleReporter.ErrorEvent) {
    // params.lineColumns is flat pairs of line and columns from each stack frame, we only care about the first one
    const [line = null, column = null] = params.lineColumns;

    if (line === null || column === null) {
      return;
    }

    // params.urls is the url from each stack frame, and again we only care about the first one
    const [url = null] = params.urls;
    if (!url) {
      return;
    }

    const uri = vscode.Uri.file(url);

    // range is really just 1 character here..
    const range = new vscode.Range(new vscode.Position(line - 1, column - 1), new vscode.Position(line - 1, column));

    const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());

    // ...but we want to highlight the entire word after(inclusive) the character
    const rangeOfWord = editor?.document.getWordRangeAtPosition(range.start) ?? range; // Fallback to just the character if no editor or no word range is found

    const diagnostic = new vscode.Diagnostic(
      rangeOfWord,
      stripAnsi(params.message).trim() || params.name || "Error",
      vscode.DiagnosticSeverity.Error,
    );

    this.editorState.setDiagnostic(uri, diagnostic);
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
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.knownOpenSockets.size === 0) {
          this.editorState.clearAll();
        }
      }),
    );

    this.signal.on("Signal.Socket.connect", this.handleSignalReceived.bind(this));
  }
}

export async function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  const manager = await BunDiagnosticsManager.initialize(context);

  context.subscriptions.push(manager);
  context.environmentVariableCollection.append("BUN_INSPECT_NOTIFY", manager.signalUrl);
}
