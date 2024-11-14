import * as vscode from "vscode";
import { MessageId } from "../../../../../src/bake/generated";
import { ReconnectingWebSocket } from "./ws";

let diagnosticCollection: vscode.DiagnosticCollection;
let socket: ReconnectingWebSocket;

export function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("bunDiagnostics");
  context.subscriptions.push(diagnosticCollection);

  const handlers: Record<number, (view: DataView) => void> = {
    [MessageId.version]: view => {
      console.log("HMR Version:", Buffer.from(view.buffer.slice(1)).toString("ascii"));
    },
    [MessageId.errors]: view => {
      console.log("HMR Errors:", Buffer.from(view.buffer.slice(1)).toString("hex"));
    },
  };

  socket = new ReconnectingWebSocket("ws://localhost:3000/_bun/hmr", {
    onMessage: event => {
      const { data } = event;
      const view = new DataView(data as ArrayBufferLike);

      console.log(Buffer.from(view.buffer.slice(0, 1)).toString("ascii"));

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

  console.log({ socket }, "hi");
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

export function deactivateDiagnosticsSocket() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }

  if (socket) {
    socket.close();
  }
}
