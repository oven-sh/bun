/**
 * Automatically generates tasks from package.json scripts.
 */
import * as path from "node:path";
import * as vscode from "vscode";
import { debugCommand } from "../debug";
import { BunTask } from "./tasks";

/**
 * Parses tasks defined in the package.json.
 */
export async function providePackageJsonTasks(): Promise<BunTask[]> {
  //
  const scripts: Record<string, string> = await (async () => {
    try {
      const file = vscode.Uri.file(vscode.workspace.workspaceFolders[0]?.uri.fsPath + "/package.json");

      // Load contents of package.json, no need to check if file exists, we return null if it doesn't
      const contents = await vscode.workspace.fs.readFile(file);
      return JSON.parse(contents.toString()).scripts;
    } catch {
      return null;
    }
  })();
  if (!scripts) return [];

  return Object.entries(scripts).map(([name, script]) => {
    // Prefix script with bun if it doesn't already start with bun
    const shellCommand = script.startsWith("bun run ") ? script : `bun run ${script}`;

    const task = new BunTask({
      script,
      name,
      detail: `${shellCommand} - package.json`,
      execution: new vscode.ShellExecution(shellCommand),
    });
    return task;
  });
}

export function registerPackageJsonProviders(context: vscode.ExtensionContext) {
  registerCodeLensProvider(context);
  registerHoverProvider(context);
}

/** Turns a quoted JSON string token into its value, with backslash escapes resolved. */
function unquote(token: string): string {
  try {
    return JSON.parse(token);
  } catch {
    return token.replace(/(?<!\\)"/g, "").trim();
  }
}

/**
 * Utility function to extract the scripts from a package.json file, including their name and position in the document.
 */
function extractScriptsFromPackageJson(document: vscode.TextDocument) {
  const content = document.getText();
  const matches = content.match(/"scripts"\s*:\s*{([\s\S]*?)}/);
  if (!matches || matches.length < 2) return null;

  const startIndex = content.indexOf(matches[0]);
  const endIndex = startIndex + matches[0].length;
  const range = new vscode.Range(document.positionAt(startIndex), document.positionAt(endIndex));

  const scripts = matches[1].split(/,\s*/).flatMap(script => {
    const elements = script.match(/"([^"\\]|\\.|\\\n)*"/g);
    if (elements?.length != 2) return [];
    const [name, command] = elements;
    return {
      name: unquote(name),
      command: unquote(command),
      range: new vscode.Range(
        document.positionAt(startIndex + matches[0].indexOf(name)),
        document.positionAt(startIndex + matches[0].indexOf(name) + name.length + command.length),
      ),
    };
  });

  return {
    range,
    scripts,
  };
}

/**
 * This function registers a CodeLens provider for package.json files. It is used to display the "Run" and "Debug" buttons
 * above the scripts properties in package.json (inline).
 */
function registerCodeLensProvider(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    // Register CodeLens provider for package.json files
    vscode.languages.registerCodeLensProvider(
      {
        language: "json",
        scheme: "file",
        pattern: "**/package.json",
      },
      {
        provideCodeLenses(document: vscode.TextDocument) {
          const extracted = extractScriptsFromPackageJson(document);
          if (!extracted) return [];
          const { range } = extracted;

          const codeLenses: vscode.CodeLens[] = [];
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: "$(breakpoints-view-icon) Bun: Debug",
              tooltip: "Debug a script using bun",
              command: "extension.bun.codelens.run",
              arguments: [{ type: "debug", uri: document.uri }],
            }),
            new vscode.CodeLens(range, {
              title: "$(debug-start) Bun: Run",
              tooltip: "Run a script using bun",
              command: "extension.bun.codelens.run",
              arguments: [{ type: "run", uri: document.uri }],
            }),
          );
          return codeLenses;
        },
        resolveCodeLens(codeLens) {
          return codeLens;
        },
      },
    ),
    // Register the commands that are executed when clicking the CodeLens buttons
    vscode.commands.registerCommand(
      "extension.bun.codelens.run",
      async ({ type, uri }: { type: "debug" | "run"; uri: vscode.Uri }) => {
        const document = await vscode.workspace.openTextDocument(uri);
        const entries = Object.entries(parseScripts(document));
        if (entries.length === 0) return;

        const pick = await vscode.window.showQuickPick(
          entries.map(([name, script]) => ({
            label: name,
            detail: script,
          })),
        );
        if (!pick) return;

        const command = type === "debug" ? "extension.bun.codelens.debug.task" : "extension.bun.codelens.run.task";

        await vscode.commands.executeCommand(command, {
          script: pick.detail,
          name: pick.label,
          cwd: path.dirname(uri.fsPath),
        });
      },
    ),
  );
}

/**
 * Reads the scripts of a package.json document. A document that is not strict JSON (comments, a trailing comma,
 * an unsaved edit) falls back to the same lenient extractor that places the CodeLens and hover buttons.
 */
function parseScripts(document: vscode.TextDocument): Record<string, string> {
  let scripts: unknown;
  try {
    scripts = JSON.parse(document.getText()).scripts;
  } catch {
    const extracted = extractScriptsFromPackageJson(document)?.scripts ?? [];
    return Object.fromEntries(extracted.map(({ name, command }) => [name, command]));
  }
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return {};
  return Object.fromEntries(Object.entries(scripts).filter(([, script]) => typeof script === "string"));
}

/**
 * bun reads the package.json from disk, while the picker and the hover show the editor buffer.
 * Returns false when the manifest is dirty and could not be saved.
 */
async function saveManifest(cwd: string): Promise<boolean> {
  const manifest = vscode.workspace.textDocuments.find(
    document => document.uri.scheme === "file" && document.uri.fsPath === path.join(cwd, "package.json"),
  );
  if (!manifest?.isDirty) return true;
  if (await manifest.save()) return true;
  vscode.window.showErrorMessage(`Could not save ${manifest.uri.fsPath}. The script was not run.`);
  return false;
}

/** Quotes a script name for the default terminal shell, so that bun receives it as one argument. */
function quoteScriptName(name: string): string {
  if (/^[\w.:@/-]+$/.test(name)) return name;
  const shell = vscode.env.shell.split(/[\\/]/).pop()!.toLowerCase();
  // cmd.exe has no single quotes. The C runtime reads \" inside double quotes as a literal quote.
  if (shell === "cmd.exe") return `"${name.replace(/"/g, '\\"')}"`;
  // Single quotes are literal in sh and in PowerShell. PowerShell escapes a quote as '', sh as '\''.
  const quote = shell.startsWith("pwsh") || shell.startsWith("powershell") ? "''" : "'\\''";
  return `'${name.replace(/'/g, quote)}'`;
}

function getActiveTerminal(name: string, cwd: string) {
  return vscode.window.terminals.filter(terminal => {
    if (terminal.name !== name) return false;
    const { cwd: terminalCwd } = terminal.creationOptions as vscode.TerminalOptions;
    return (typeof terminalCwd === "string" ? terminalCwd : terminalCwd?.fsPath) === cwd;
  });
}

interface CommandArgs {
  script: string;
  name: string;
  cwd: string;
}

/**
 * This function registers a Hover language feature provider for package.json files. It is used to display the
 * "Run" and "Debug" buttons when hovering over a script property in package.json.
 */
function registerHoverProvider(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: "json", scheme: "file", pattern: "**/package.json" },
      {
        provideHover(document, position) {
          const scripts = extractScriptsFromPackageJson(document)?.scripts ?? [];
          const cwd = path.dirname(document.uri.fsPath);

          return {
            contents: scripts.map(script => {
              if (!script.range.contains(position)) return null;

              const command = encodeURIComponent(JSON.stringify({ script: script.command, name: script.name, cwd }));

              const markdownString = new vscode.MarkdownString(
                `[Debug](command:extension.bun.codelens.debug.task?${command}) | [Run](command:extension.bun.codelens.run.task?${command})`,
              );
              markdownString.isTrusted = true;

              return markdownString;
            }),
          };
        },
      },
    ),
    vscode.commands.registerCommand("extension.bun.codelens.debug.task", async ({ script, cwd }: CommandArgs) => {
      if (script.startsWith("bun run ")) script = script.slice(8);
      if (script.startsWith("bun ")) script = script.slice(4);

      debugCommand(script, cwd);
    }),
    vscode.commands.registerCommand("extension.bun.codelens.run.task", async ({ name, cwd }: CommandArgs) => {
      if (!(await saveManifest(cwd))) return;

      // Run the script by name from the package directory, so bun applies pre/post hooks and env assignments.
      const command = `bun run ${quoteScriptName(name)}`;
      const terminalName = `Bun Task: ${name}`;

      const terminals = getActiveTerminal(terminalName, cwd);
      if (terminals.length > 0) {
        terminals[0].show();
        terminals[0].sendText(command);
        return;
      }

      const terminal = vscode.window.createTerminal({ name: terminalName, cwd });
      terminal.show();
      terminal.sendText(command);
    }),
  );
}
