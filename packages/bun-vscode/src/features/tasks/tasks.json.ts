/**
 * Parses tasks defined in the vscode tasks.json file.
 * For more information, see https://code.visualstudio.com/api/extension-guides/task-provider
 */
import * as vscode from "vscode";
import { BunTask } from ".";

export function resolveTask(task: BunTask): BunTask | undefined {
    // Make sure the task is run with bun
    const script = task.definition.script;
    if(!script) return task;
    const definition: BunTask["definition"] = task.definition;
    const shellCommand = script.startsWith("bun") ? script : `bun ${script}`;

    return new vscode.Task(
      definition,
      task.scope ?? vscode.TaskScope.Workspace,
      task.name,
      "bun",
      new vscode.ShellExecution(shellCommand),
    ) as BunTask;
}