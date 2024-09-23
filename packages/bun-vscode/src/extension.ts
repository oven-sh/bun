import * as vscode from "vscode";
import { registerDebugger } from "./features/debug";
import { registerBunlockEditor } from "./features/lockfile";
import { registerPackageJsonProviders } from "./features/tasks/package.json";
import { registerTaskProvider } from "./features/tasks/tasks";

export function activate(context: vscode.ExtensionContext) {
  registerBunlockEditor(context);
  registerDebugger(context);
  registerTaskProvider(context);
  registerPackageJsonProviders(context);
}

export function deactivate() {}
