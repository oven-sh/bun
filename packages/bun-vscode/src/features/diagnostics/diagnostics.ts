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

    this.editorState.clearAll();

    debugAdapter.on("LifecycleReporter.reload", async () => {
      this.editorState.clearAll();
    });

    // debugAdapter.on("Inspector.event", e => {
    //   console.log(e.method);
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
      sendImmediatePreventExit: false,
    });
  }

  private static findMostRelevantErrors(error: JSC.LifecycleReporter.ErrorEvent) {
    // Ideally we find at least 1 error which will be like in the user's file `src/index.ts` or something.
    // Sometimes the error might ocurr inside of node modules, it's still useful for us to show that.
    // BUT with that said, we also might want to show the error in the user's file as well.
    // So with that in mind, this function should return an array of 0, 1, or 2 urls and line/columns.
    // If there are no valid urls (empty string or undefined or whatever) we can't do shit so just reutrn null;

    const [firstUrl] = error.urls;

    if (!firstUrl) {
      return [];
    }

    const [firstUrlLine = null, firstUrlCol = null] = error.lineColumns;

    if (firstUrlLine === null || firstUrlCol === null) {
      return [];
    }

    const first = {
      url: firstUrl,
      line: firstUrlLine,
      col: firstUrlCol,
    };

    const isInNodeModules = first.url.includes("node_modules/");

    if (!isInNodeModules) {
      // Not node modules, so it's going to be the most relevant we'll get for the user
      return [first];
    }

    // Find the first file in the stack frames that are not inside node_modules
    const pathInUsersDirectory = BunDiagnosticsManager.findFirstUserlandURL(error.urls);

    // No other user files (lol?) so just reply with the node_modules path
    if (!pathInUsersDirectory) {
      return [first];
    }

    const line = error.lineColumns[pathInUsersDirectory.index * 2] ?? null;
    const col = error.lineColumns[pathInUsersDirectory.index * 2 + 1] ?? null;

    // Best effort, but malformed data most likely. Better than returning invalid values below anyway
    if (line === null || col === null) {
      return [first];
    }

    return [
      first,
      {
        url: pathInUsersDirectory.url,
        line,
        col,
      },
    ];
  }

  private static findFirstUserlandURL(urls: string[]) {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      if (url === "") {
        continue;
      }

      if (url.includes("node_modules/")) {
        continue;
      }

      return { url, index: i };
    }

    return null;
  }

  private handleLifecycleError(event: JSC.LifecycleReporter.ErrorEvent) {
    const relevantErrors = BunDiagnosticsManager.findMostRelevantErrors(event);

    for (const error of relevantErrors) {
      const uri = vscode.Uri.file(error.url);

      // range is really just 1 character here..
      const range = new vscode.Range(
        new vscode.Position(error.line - 1, error.col - 1),
        new vscode.Position(error.line - 1, error.col),
      );

      const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());

      // ...but we want to highlight the entire word after(inclusive) the character
      const rangeOfWord = document?.getWordRangeAtPosition(range.start) ?? range; // Fallback to just the character if no editor or no word range is found

      const diagnostic = new vscode.Diagnostic(
        rangeOfWord,
        stripAnsi(event.message).trim() || event.name || "Error",
        vscode.DiagnosticSeverity.Error,
      );

      this.editorState.setDiagnostic(uri, diagnostic);
    }
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
      vscode.workspace.onDidChangeTextDocument(() => {
        this.editorState.clearAll();
      }),
    );

    this.signal.on("Signal.Socket.connect", this.handleSignalReceived.bind(this));
  }
}

const description = new vscode.MarkdownString(
  "Bun's VSCode extension communicates with Bun over a socket, which we set the url in your terminal with the `BUN_INSPECT_NOTIFY` environment variable",
);

export async function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  context.environmentVariableCollection.persistent = false;
  context.environmentVariableCollection.description = description;

  const manager = await BunDiagnosticsManager.initialize(context);
  context.environmentVariableCollection.replace("BUN_INSPECT_NOTIFY", manager.signalUrl);

  context.subscriptions.push(manager);
}
