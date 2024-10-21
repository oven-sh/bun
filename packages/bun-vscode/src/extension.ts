import * as vscode from "vscode";
import { registerDebugger } from "./features/debug";
import { registerBunlockEditor } from "./features/lockfile";
import { registerTestCodeLens, registerTestRunner } from "./features/tests";
import { registerPackageJsonProviders } from "./features/tasks/package.json";
import { registerTaskProvider } from "./features/tasks/tasks";

export function activate(context: vscode.ExtensionContext) {
  registerBunlockEditor(context);
  registerDebugger(context);
  registerTaskProvider(context);
  registerPackageJsonProviders(context);
  registerTestRunner(context);
  registerTestCodeLens(context);
}

export function deactivate() {}
