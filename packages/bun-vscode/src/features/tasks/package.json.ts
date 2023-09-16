/**
 * Automatically generates tasks from package.json scripts.
 */
import * as vscode from "vscode";
import { BunTask } from ".";

export async function getPackageJsonTasks(): Promise<BunTask[]>{
    const packageJson = await readPackageJson();
    if(!packageJson) return []
    
    const scriptNames = Object.keys(packageJson.scripts);
    
    return scriptNames.map((scriptName: string) => {
      const script = packageJson.scripts[scriptName];
      
      // Prefix script with bun if it doesn't already start with bun
      const shellCommand = script.startsWith("bun") ? script : `bun ${script}`;
      
      const task = new vscode.Task(
        { type: "bun" },
        vscode.TaskScope.Workspace,
        scriptName,
        "bun",
        new vscode.ShellExecution(shellCommand)
        ) as BunTask;
        task.detail = shellCommand;
      return task;
    });
}



async function readPackageJson(): Promise<any>{
    try{
      const packageJSON = vscode.workspace.workspaceFolders[0]?.uri.fsPath + "/package.json";
  
      // Check if package.json exists
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(packageJSON));
      if (!stat) {
        return;
      }
  
      // Load contents of package.json
      const contents = await vscode.workspace.fs.readFile(vscode.Uri.file(packageJSON));
      return JSON.parse(contents.toString());
    } catch{
        return null
    }
  }