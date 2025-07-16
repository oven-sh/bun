import * as vscode from "vscode";
import { registerDebugger } from "./features/debug";
import { registerDiagnosticsSocket } from "./features/diagnostics/diagnostics";
import { registerBunlockEditor } from "./features/lockfile";
import { registerPackageJsonProviders } from "./features/tasks/package.json";
import { registerTaskProvider } from "./features/tasks/tasks";
import { registerTests } from "./features/tests";

async function runUnsavedCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.isUntitled) {
    return;
  }

  const document = editor.document;
  if (!["javascript", "typescript", "javascriptreact", "typescriptreact"].includes(document.languageId)) {
    return;
  }

  const code = document.getText();
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Get the actual untitled document name
  const untitledName = `untitled:${document.uri.path}`;

  // Create a temporary debug session without saving
  await vscode.debug.startDebugging(
    undefined,
    {
      type: "bun",
      name: "Run Unsaved Code",
      request: "launch",
      program: "-", // Special flag to indicate stdin input
      __code: code, // Pass the code through configuration
      __untitledName: untitledName, // Pass the untitled document name
      cwd, // Pass the current working directory
    },
    {
      suppressSaveBeforeStart: true, // This prevents the save dialog
    },
  );
}

export function activate(context: vscode.ExtensionContext) {
  registerBunlockEditor(context);
  registerDebugger(context);
  registerTaskProvider(context);
  registerPackageJsonProviders(context);
  registerDiagnosticsSocket(context);
  registerTests(context);

  // Only register for text editors
  context.subscriptions.push(vscode.commands.registerTextEditorCommand("extension.bun.runUnsavedCode", runUnsavedCode));
}

export function getConfig<T>(path: string, scope?: vscode.ConfigurationScope) {
  return vscode.workspace.getConfiguration("bun", scope).get<T>(path);
}
