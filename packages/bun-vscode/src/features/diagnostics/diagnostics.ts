import * as vscode from "vscode";
import { MessageId } from "../../../../../src/bake/generated";
import { ReconnectingWebSocket } from "./ws";

export function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("BunDiagnostics");
  context.subscriptions.push(diagnosticCollection);

  const handlers: Record<number, (view: DataView) => void> = {
    [MessageId.version]: view => {
      console.log("HMR Version:", Buffer.from(view.buffer.slice(1)).toString("ascii"));
    },
    [MessageId.errors]: view => {
      console.log("HMR Errors:", Buffer.from(view.buffer.slice(1)).toString("hex"));
    },
    [MessageId.route_update]: view => {
      const uri = vscode.Uri.file("/Users/ali/code/bun/packages/bun-vscode/example/bug/pages/index.tsx");
      const diagnostics: vscode.Diagnostic[] = [];

      const line = 2;
      const column = 3;
      const message = "something went mad wrong";

      const range = new vscode.Range(new vscode.Position(line, column), new vscode.Position(line, column + 1));
      const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);

      diagnostics.push(diagnostic);

      diagnosticCollection.set(uri, diagnostics);
    },
  };

  const socket = new ReconnectingWebSocket("ws://localhost:3000/_bun/hmr", {
    onMessage: event => {
      const { data } = event;
      const view = new DataView(data as ArrayBufferLike);

      console.log(parseInt(Buffer.from(view.buffer.slice(0, 1)).toString("hex"), 16).toString());

      handlers[view.getUint8(0)]?.(view);
    },

    onError: error => console.error(error),

    onOpen: () => console.log("Connected to HMR"),
    onClose: () => console.log("Disconnected from HMR"),
    onReconnect: () => console.log("Reconnected to HMR"),

    // Reasonable to keep checking if the server is up every 3s while vsc is open.
    // Post-poc this can be done by some messaging from Bun to the extension, but for now this is fine.
    timeout: 3000,
  }).open(ws => {
    ws.binaryType = "arraybuffer";
  });

  context.subscriptions.push({
    dispose() {
      socket.close();
    },
  });
}

function parseDiagnostics(data: string): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const messages = JSON.parse(data);

  for (const message of messages) {
    const range = new vscode.Range(
      new vscode.Position(message.line - 1, message.character - 1),
      new vscode.Position(message.endLine - 1, message.endCharacter - 1),
    );

    const diagnostic = new vscode.Diagnostic(range, message.message, vscode.DiagnosticSeverity.Error);

    diagnostics.push(diagnostic);
  }

  return diagnostics;
}
