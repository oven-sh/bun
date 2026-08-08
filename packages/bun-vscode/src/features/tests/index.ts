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
  const controllers = new Map<
    string,
    { controller: vscode.TestController; bun: vscode.Disposable; folder: vscode.WorkspaceFolder }
  >();
  let shownVersionError = false;

  // Disambiguate the folder name only when more than one folder is open; a
  // single-root workspace keeps the plain "Bun Tests" title.
  const labelFor = (folder: vscode.WorkspaceFolder): string =>
    (vscode.workspace.workspaceFolders || []).length > 1 ? `Bun Tests (${folder.name})` : "Bun Tests";

  const refreshLabels = (): void => {
    for (const { controller, folder } of controllers.values()) {
      controller.label = labelFor(folder);
    }
  };

  const addFolder = (folder: vscode.WorkspaceFolder): void => {
    const key = folder.uri.toString();
    if (controllers.has(key)) {
      return;
    }

    const enable = vscode.workspace.getConfiguration("bun.test", folder.uri).get<boolean>("enable", true);
    if (!enable) {
      return;
    }

    let controller: vscode.TestController | undefined;
    try {
      controller = vscode.tests.createTestController(`bun:${key}`, labelFor(folder));
      const bun = createController(controller, folder);
      controllers.set(key, { controller, bun, folder });
    } catch (error) {
      controller?.dispose();
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
      // Folder count may have crossed the single/multi-root boundary.
      refreshLabels();
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
