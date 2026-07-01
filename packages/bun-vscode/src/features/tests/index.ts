import * as vscode from "vscode";
import { BunTestController, debug } from "./bun-test-controller";

export type TestControllerFactory = (
  controller: vscode.TestController,
  folder: vscode.WorkspaceFolder,
) => vscode.Disposable;

export async function registerTests(
  context: vscode.ExtensionContext,
  createController: TestControllerFactory = (controller, folder) => new BunTestController(controller, folder),
) {
  // One controller per workspace folder so each folder resolves its own
  // folder-scoped settings (`bun.runtime`, `bun.test.*`) and discovers tests
  // with its own `filePattern`. This is what makes multi-root workspaces work.
  const controllers = new Map<string, { controller: vscode.TestController; bun: vscode.Disposable }>();
  let shownVersionError = false;

  const addFolder = (folder: vscode.WorkspaceFolder): void => {
    const key = folder.uri.toString();
    if (controllers.has(key)) {
      return;
    }

    const enable = vscode.workspace.getConfiguration("bun.test", folder.uri).get<boolean>("enable", true);
    if (!enable) {
      return;
    }

    try {
      const multiRoot = (vscode.workspace.workspaceFolders || []).length > 1;
      const controller = vscode.tests.createTestController(
        `bun:${key}`,
        multiRoot ? `Bun Tests (${folder.name})` : "Bun Tests",
      );
      const bun = createController(controller, folder);
      controllers.set(key, { controller, bun });
    } catch (error) {
      debug.appendLine(`Error initializing Bun Test Controller: ${error}`);
      if (!shownVersionError) {
        shownVersionError = true;
        vscode.window.showErrorMessage(
          "Failed to initialize Bun Test Explorer. You may need to update VS Code to version 1.59 or later.",
        );
      }
    }
  };

  const removeFolder = (folder: vscode.WorkspaceFolder): void => {
    const key = folder.uri.toString();
    const entry = controllers.get(key);
    if (!entry) {
      return;
    }
    entry.bun.dispose();
    entry.controller.dispose();
    controllers.delete(key);
  };

  for (const folder of vscode.workspace.workspaceFolders || []) {
    addFolder(folder);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(event => {
      for (const folder of event.removed) removeFolder(folder);
      for (const folder of event.added) addFolder(folder);
    }),
    {
      dispose() {
        for (const { controller, bun } of controllers.values()) {
          bun.dispose();
          controller.dispose();
        }
        controllers.clear();
      },
    },
  );
}
