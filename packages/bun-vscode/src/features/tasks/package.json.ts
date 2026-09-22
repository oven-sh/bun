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
      name: name.replace(/(?<!\\)"/g, "").trim(),
      command: command.replace(/(?<!\\)"/g, "").trim(),
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

        vscode.commands.executeCommand(command, {
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

async function saveManifest(cwd: string) {
  const manifest = vscode.workspace.textDocuments.find(
    document => document.uri.scheme === "file" && document.uri.fsPath === path.join(cwd, "package.json"),
  );
  if (manifest?.isDirty) await manifest.save();
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
      { language: "json", scheme: "file" },
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
      // bun reads the package.json from disk, while the picker and the hover show the editor buffer.
      await saveManifest(cwd);

      // Run the script by name from the package directory, so bun applies pre/post hooks and env assignments.
      // Double quotes, with \" for an embedded quote, are the one quoting form that sh, PowerShell and cmd all accept.
      const argument = /^[\w.:@/-]+$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
      const command = `bun run ${argument}`;
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
