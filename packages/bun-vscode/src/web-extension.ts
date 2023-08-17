import * as vscode from "vscode";
import { activateBunDebug } from "./activate";

export function activate(context: vscode.ExtensionContext) {
  activateBunDebug(context);
}

export function deactivate() {}
