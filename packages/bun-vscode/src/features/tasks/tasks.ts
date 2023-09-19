import * as vscode from "vscode";
import { providePackageJsonTasks } from "./package.json";

interface BunTaskDefinition extends vscode.TaskDefinition {
  script: string;
}

export class BunTask extends vscode.Task {
  declare definition: BunTaskDefinition;

  constructor({
    script,
    name,
    detail,
    execution,
    scope = vscode.TaskScope.Workspace,
  }: {
    script: string;
    name: string;
    detail?: string;
    scope?: vscode.WorkspaceFolder | vscode.TaskScope.Global | vscode.TaskScope.Workspace;
    execution?: vscode.ProcessExecution | vscode.ShellExecution | vscode.CustomExecution;
  }) {
    super({ type: "bun", script }, scope, name, "bun", execution);
    this.detail = detail;
  }
}

/**
 * Registers the task provider for the bun extension.
 */
export function registerTaskProvider(context: vscode.ExtensionContext) {
  const taskProvider: vscode.TaskProvider<BunTask> = {
    provideTasks: async () => await providePackageJsonTasks(),
    resolveTask: task => resolveTask(task),
  };
  context.subscriptions.push(vscode.tasks.registerTaskProvider("bun", taskProvider));
}

/**
 * Parses tasks defined in the vscode tasks.json file.
 * For more information, see https://code.visualstudio.com/api/extension-guides/task-provider
 */
export function resolveTask(task: BunTask): BunTask | undefined {
  // Make sure the task has a script defined
  const definition: BunTask["definition"] = task.definition;
  if (!definition.script) return task;
  const shellCommand = definition.script.startsWith("bun ") ? definition.script : `bun ${definition.script}`;

  const newTask = new vscode.Task(
    definition,
    task.scope ?? vscode.TaskScope.Workspace,
    task.name,
    "bun",
    new vscode.ShellExecution(shellCommand),
  ) as BunTask;
  newTask.detail = `${shellCommand} - tasks.json`;
  return newTask;
}
