import * as vscode from "vscode";
import activateLockfile from "./features/lockfile";
import activateDebug from "./features/debug";

export function activate(context: vscode.ExtensionContext) {
  activateLockfile(context);
  activateDebug(context);
}

export function deactivate() {}
