import * as vscode from "vscode";
import { getPackageJsonTasks } from "./package.json";
import { resolveTask } from "./tasks.json";

export interface BunTask extends vscode.Task {
  definition: {
    type: "bun";
    script: string;
  };
}

export function registerTaskProvider(context: vscode.ExtensionContext) {
  const taskProvider: vscode.TaskProvider<BunTask> = {
    async provideTasks(token) {
      return [...(await getPackageJsonTasks())];
    },
    resolveTask(task, token) {
      return resolveTask(task);
    },
  };
  const disposable = vscode.tasks.registerTaskProvider("bun", taskProvider);
  context.subscriptions.push(disposable);
}
