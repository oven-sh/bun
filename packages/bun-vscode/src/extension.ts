import * as vscode from "vscode";
import activateLockfile from "./features/lockfile";
import activateDebug from "./features/debug";
import { registerTaskProvider } from "./features/tasks";

export function activate(context: vscode.ExtensionContext) {
  activateLockfile(context);
  activateDebug(context);
  registerTaskProvider(context);
  
}

export function deactivate() {}
