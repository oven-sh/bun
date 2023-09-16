import * as vscode from "vscode";
import activateLockfile from "./features/lockfile";
import { registerTaskProvider } from "./features/tasks/tasks";
import { registerDebugger } from "./features/debug";
import { registerPackageJsonProviders } from "./features/tasks/package.json";

export function activate(context: vscode.ExtensionContext) {
  activateLockfile(context);
  registerDebugger(context);
  registerTaskProvider(context);
  registerPackageJsonProviders(context);
}

export function deactivate() {}
