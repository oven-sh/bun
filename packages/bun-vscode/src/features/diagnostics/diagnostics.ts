import { Socket } from "node:net";
import * as os from "node:os";
import stripAnsi from "strip-ansi";
import * as vscode from "vscode";
import {
  getAvailablePort,
  NodeSocketDebugAdapter,
  TCPSocketSignal,
  UnixSignal,
} from "../../../../bun-debug-adapter-protocol";
import type { JSC } from "../../../../bun-inspector-protocol";

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
  private editorState: EditorStateManager;
  private signal: UnixSignal | TCPSocketSignal;
  private context: vscode.ExtensionContext;

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
  private async handleSignalReceived(socket: Socket, url: string) {
    console.log("Socket connected");
    const debugAdapter = new NodeSocketDebugAdapter(socket, url);

    this.editorState.clearAll();

    debugAdapter.on("LifecycleReporter.reload", async () => {
      this.editorState.clearAll();
    });

    debugAdapter.on("Inspector.event", async event => {
      console.log(event.method);
    });

    debugAdapter.on("LifecycleReporter.error", event => this.handleLifecycleError(event));

    const dispose = async () => {
      debugAdapter.removeAllListeners();
      await debugAdapter.send("LifecycleReporter.stopPreventingExit");
      debugAdapter.close();
      this.editorState.clearAll();
    };

    socket.once("close", async () => {
      void vscode.window.showInformationMessage("Bun debug adapter has stopped");
      await dispose();
    });

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

    // ...but we want to highlight the entire word after(inclusive) the character
    const rangeOfWord = vscode.window.activeTextEditor?.document.getWordRangeAtPosition(range.start) ?? range; // Fallback to just the character if no word range is found

    const diagnostic = new vscode.Diagnostic(
      rangeOfWord,
      stripAnsi(params.message).trim(),
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

    this.handleSignalReceived = this.handleSignalReceived.bind(this);

    this.signal.on("Signal.Socket.connect", socket => this.handleSignalReceived(socket, this.signal.url));
  }
}

export async function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  const manager = await BunDiagnosticsManager.initialize(context);

  context.subscriptions.push(manager);
  context.environmentVariableCollection.append("BUN_INSPECT_NOTIFY", manager.signalUrl);
}
