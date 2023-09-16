import * as vscode from "vscode";
import { registerTaskProvider } from "./features/tasks/tasks";
import { registerDebugger } from "./features/debug";
import { registerPackageJsonProviders } from "./features/tasks/package.json";
import { registerBunlockEditor } from "./features/lockfile";

export function activate(context: vscode.ExtensionContext) {
  registerBunlockEditor(context);
  registerDebugger(context);
  registerTaskProvider(context);
  registerPackageJsonProviders(context);
}

export function deactivate() {}
