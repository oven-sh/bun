import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { getConfig } from "../extension";

// Languages `bun fmt` can format. Entries without a VS Code language
// (toml, mdx, ...) are harmless: the provider is simply never called for them.
const SELECTOR: vscode.DocumentSelector = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  "json",
  "jsonc",
  "css",
  "less",
  "scss",
  "html",
  "vue",
  "svelte",
  "yaml",
  "markdown",
  "mdx",
  "graphql",
  "handlebars",
  "toml",
];

const EXT_BY_LANGUAGE: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  javascriptreact: "jsx",
  typescriptreact: "tsx",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  less: "less",
  scss: "scss",
  html: "html",
  vue: "vue",
  svelte: "svelte",
  yaml: "yaml",
  markdown: "md",
  mdx: "mdx",
  graphql: "graphql",
  handlebars: "hbs",
  toml: "toml",
};

function getRuntime(): string {
  const value = getConfig<string>("runtime");
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return "bun";
}

function stdinFilepath(document: vscode.TextDocument): string {
  if (document.uri.scheme === "file") {
    return document.uri.fsPath;
  }
  // shortcut: untitled/remote docs lose overrides, .editorconfig and ignore rules, which all go by file path.
  return `untitled.${EXT_BY_LANGUAGE[document.languageId] ?? "ts"}`;
}

function formatWithBun(document: vscode.TextDocument, token: vscode.CancellationToken, output: vscode.OutputChannel): Promise<vscode.TextEdit[]> {
  return new Promise(resolve => {
    const text = document.getText();
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const child = spawn(getRuntime(), ["fmt", "--stdin-filepath", stdinFilepath(document)], {
      cwd: folder?.uri.fsPath,
      stdio: ["pipe", "pipe", "pipe"],
    });
    token.onCancellationRequested(() => child.kill());

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
    child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
    child.on("error", (err) => {
      output.appendLine(`[bun fmt] spawn error: ${err.message}`);
      resolve([]);
    });
    child.stdin.on("error", (err) => {
      output.appendLine(`[bun fmt] stdin write error: ${err.message}`);
      resolve([]);
    });
    child.on("close", code => {
      if (code !== 0) {
        if (stderr) output.appendLine(`[bun fmt] exited with code ${code}: ${stderr.trim()}`);
        else output.appendLine(`[bun fmt] exited with code ${code}`);
        resolve([]);
        return;
      }
      if (stdout === text) {
        resolve([]);
        return;
      }
      const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
      resolve([vscode.TextEdit.replace(fullRange, stdout)]);
    });

    child.stdin.write(text);
    child.stdin.end();
  });
}

export function registerFormatter(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Bun Formatter");
  context.subscriptions.push(output);

  const provider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits: (document, _options, token) => formatWithBun(document, token, output),
  };
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, provider),
  );
}
