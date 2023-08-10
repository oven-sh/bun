import * as vscode from "vscode";
import { activateBunDebug } from "./activate";

const runMode: "external" | "server" | "namedPipeServer" | "inline" = "inline";

export function activate(context: vscode.ExtensionContext) {
  if (runMode === "inline") {
    activateBunDebug(context);
    return;
  }
  throw new Error(`This extension does not support '${runMode}' mode.`);
}

export function deactivate() {
  // No-op
}
