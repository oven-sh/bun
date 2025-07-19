import * as vscode from "vscode";
import { BunTestController, debug } from "./bun-test-controller";

export async function registerTests(context: vscode.ExtensionContext) {
  const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
  if (!workspaceFolder) {
    return;
  }

  const config = vscode.workspace.getConfiguration("bun.test");
  const enable = config.get<boolean>("enable", true);
  if (!enable) {
    return;
  }

  try {
    const controller = vscode.tests.createTestController("bun", "Bun Tests");
    context.subscriptions.push(controller);

    const bunTestController = new BunTestController(controller, workspaceFolder);

    context.subscriptions.push(bunTestController);
  } catch (error) {
    debug.appendLine(`Error initializing Bun Test Controller: ${error}`);
    vscode.window.showErrorMessage(
      "Failed to initialize Bun Test Explorer. You may need to update VS Code to version 1.59 or later.",
    );
  }
}
