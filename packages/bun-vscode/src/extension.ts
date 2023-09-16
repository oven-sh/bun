import * as vscode from "vscode";
import activateLockfile from "./features/lockfile";
import activateDebug from "./features/debug";
import { registerTaskProvider } from "./features/tasks";
import { registerCodeLensProvider } from "./features/codelens";

export function activate(context: vscode.ExtensionContext) {
  activateLockfile(context);
  activateDebug(context);
  registerTaskProvider(context);
  registerCodeLensProvider(context);
}

export function deactivate() {}
