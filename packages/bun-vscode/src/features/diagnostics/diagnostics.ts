import * as vscode from "vscode";
import WebSocket from "ws";

let diagnosticCollection: vscode.DiagnosticCollection;

export function registerDiagnosticsSocket(context: vscode.ExtensionContext) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("bunDiagnostics");
  context.subscriptions.push(diagnosticCollection);

  const ws = new WebSocket("", {
    perMessageDeflate: false,
  });

  ws.onmessage = event => {
    const diagnostics = parseDiagnostics(event.data.toString());

    if (diagnostics.length !== 0) {
      diagnosticCollection.set(vscode.window.activeTextEditor.document.uri, diagnostics);
    }
  };

  // ws.onclose = () => {
  //   vscode.window.showInformationMessage("Bun Diagnostics WebSocket closed");
  // };

  ws.onerror = error => {
    vscode.window.showErrorMessage(`Bun Diagnostics WebSocket error: ${error.message}`);
  };
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
}
