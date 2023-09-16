import * as vscode from "vscode";

export function registerCodeLensProvider(context: vscode.ExtensionContext) {
  let disposable = vscode.languages.registerCodeLensProvider(
    {
      language: "json",
      scheme: "file",
      pattern: "**/package.json",
    },
    {
      provideCodeLenses(document: vscode.TextDocument) {
        if (!document.fileName.endsWith("/package.json")) return [];
        const text = document.getText();

        const matches = text.match(/"scripts"\s*:\s*{([\s\S]*?)}/);
        if (!matches || matches.length < 2) return [];

        const codeLenses: vscode.CodeLens[] = [];
        const startIndex = text.indexOf(matches[0]);
        const endIndex = startIndex + matches[0].length;

        const range = new vscode.Range(document.positionAt(startIndex), document.positionAt(endIndex));
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: "$(debug-start) Bun: Run",
            tooltip: "Run a script using bun",
            command: "extension.bun.codelens.debug",
          }),
        );
        return codeLenses;
      },
      resolveCodeLens(codeLens) {
        return codeLens;
      },
    },
  );
  context.subscriptions.push(disposable);

  disposable = vscode.commands.registerCommand("extension.bun.codelens.debug", async () => {
    const tasks = await vscode.tasks.fetchTasks({ type: "bun" });
    if (tasks.length === 0) return;

    const pick = await vscode.window.showQuickPick(
      tasks.map(task => ({
        label: task.name,
        detail: task.detail ?? task.definition.script,
      })),
    );
    if (!pick) return;

    const task = tasks.find(task => task.name === pick.label);
    if (!task) return;

    vscode.tasks.executeTask(task);
  });
  context.subscriptions.push(disposable);
}
