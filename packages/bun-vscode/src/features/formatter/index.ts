import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import * as vscode from "vscode";
import { getConfig } from "../../extension";
import { FormatterCancelledError, getBunFormatterArgs, runBunFormatter } from "./process";

const SHOW_OUTPUT_COMMAND = "extension.bun.formatter.showOutput";

const SUPPORTED_LANGUAGES = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "json",
  "jsonc",
  "css",
  "scss",
  "less",
  "html",
  "vue",
  "svelte",
  "yaml",
  "toml",
  "markdown",
  "mdx",
  "graphql",
  "handlebars",
  "mjml",
];

const DOCUMENT_SELECTOR: vscode.DocumentSelector = SUPPORTED_LANGUAGES.flatMap(language => [
  { language, scheme: "file" },
  { language, scheme: "vscode-remote" },
]);

class BunDocumentFormattingEditProvider
  implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider
{
  private lastBunfigNotice: string | undefined;

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly status: vscode.StatusBarItem,
  ) {}

  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    return this.provideEdits(document, token);
  }

  async provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    return this.provideEdits(document, token, {
      start: document.offsetAt(range.start),
      end: document.offsetAt(range.end),
    });
  }

  private async provideEdits(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
    range?: { start: number; end: number },
  ): Promise<vscode.TextEdit[]> {
    const source = document.getText();
    const runtime = getConfig<string>("runtime", document.uri)?.trim() || "bun";
    const cwd = dirname(document.uri.fsPath);
    const configuredBunfig = getConfig<string>("fmt.bunfig", document.uri)?.trim();
    const workspace = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
    const fallbackBunfig = configuredBunfig ? resolveConfiguredPath(configuredBunfig, workspace ?? cwd) : undefined;
    const projectBunfig = await findActiveBunfig(cwd);
    const bunfig = projectBunfig.path ? undefined : fallbackBunfig;
    const startedAt = performance.now();

    void this.announceBunfig(bunfig, cwd);

    this.status.text = "$(sync~spin) Bun";
    this.status.tooltip = "Bun Formatter: Formatting";
    this.status.backgroundColor = undefined;
    this.log("INFO", `Formatting ${document.uri.toString()}`);
    this.log(
      "INFO",
      projectBunfig.path
        ? `Using project bunfig: ${projectBunfig.path}`
        : bunfig
          ? `Using fallback bunfig: ${bunfig}`
          : "Using Bun's automatic configuration discovery",
    );
    const command = [runtime, ...getBunFormatterArgs(document.uri.fsPath, bunfig, range)]
      .map(quoteArgument)
      .join(" ");
    this.log("INFO", `Running: ${command}`);

    try {
      const result = await runBunFormatter({
        runtime,
        bunfig,
        cwd,
        filepath: document.uri.fsPath,
        source,
        rangeStart: range?.start,
        rangeEnd: range?.end,
        token,
      });
      const formatted = result.stdout;

      if (result.stderr.trim()) {
        for (const line of result.stderr.trimEnd().split(/\r?\n/)) this.log("WARN", line);
      }

      this.status.text = "$(check) Bun";
      this.status.tooltip = "Bun Formatter: Ready";
      this.log("INFO", `Formatting completed in ${Math.round(performance.now() - startedAt)}ms`);

      if (formatted === source || token.isCancellationRequested) return [];

      return [createMinimalEdit(document, source, formatted)];
    } catch (error) {
      if (error instanceof FormatterCancelledError) {
        this.status.text = "$(check) Bun";
        this.status.tooltip = "Bun Formatter: Ready";
        this.log("INFO", "Formatting cancelled");
        return [];
      }
      const message = error instanceof Error ? error.message : String(error);
      this.status.text = "$(error) Bun";
      this.status.tooltip = `Bun Formatter: ${message}`;
      this.status.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      this.log("ERROR", message);
      this.output.show(true);
      throw error;
    }
  }

  private log(level: "INFO" | "WARN" | "ERROR", message: string) {
    this.output.appendLine(`[${level} - ${new Date().toLocaleTimeString()}] ${message}`);
  }

  private async announceBunfig(configuredBunfig: string | undefined, cwd: string) {
    const result = configuredBunfig
      ? await inspectBunfig(configuredBunfig, true)
      : await findActiveBunfig(cwd);
    const notice = result.path ? `active:${result.path}` : result.problem ? `problem:${result.problem}` : "not-found";

    if (notice === this.lastBunfigNotice) return;
    this.lastBunfigNotice = notice;

    if (result.path) {
      void vscode.window.showInformationMessage(`Bun Formatter: Using ${result.path}`);
    } else if (result.problem) {
      void vscode.window.showWarningMessage(`Bun Formatter: ${result.problem}`);
    } else {
      void vscode.window.showInformationMessage("Bun Formatter: No bunfig.toml with [fmt] was found.");
    }
  }
}

export function registerFormatter(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Bun Formatter");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = "Bun Formatter";
  status.text = "$(check) Bun";
  status.tooltip = "Bun Formatter: Ready";
  status.command = SHOW_OUTPUT_COMMAND;

  const updateStatusVisibility = (editor = vscode.window.activeTextEditor) => {
    const document = editor?.document;
    const supportedScheme = document && ["file", "vscode-remote"].includes(document.uri.scheme);
    if (document && supportedScheme && SUPPORTED_LANGUAGES.includes(document.languageId)) {
      status.show();
    } else {
      status.hide();
    }
  };

  const provider = new BunDocumentFormattingEditProvider(output, status);

  context.subscriptions.push(
    output,
    status,
    vscode.commands.registerCommand(SHOW_OUTPUT_COMMAND, () => output.show()),
    vscode.window.onDidChangeActiveTextEditor(updateStatusVisibility),
    vscode.languages.registerDocumentFormattingEditProvider(
      DOCUMENT_SELECTOR,
      provider,
    ),
    vscode.languages.registerDocumentRangeFormattingEditProvider(DOCUMENT_SELECTOR, provider),
  );
  output.appendLine(`[INFO - ${new Date().toLocaleTimeString()}] Bun Formatter activated`);
  updateStatusVisibility();
}

function createMinimalEdit(document: vscode.TextDocument, source: string, formatted: string): vscode.TextEdit {
  let start = 0;
  while (start < source.length && start < formatted.length && source[start] === formatted[start]) start++;

  let matchingSuffix = 0;
  while (
    start + matchingSuffix < source.length &&
    start + matchingSuffix < formatted.length &&
    source[source.length - matchingSuffix - 1] === formatted[formatted.length - matchingSuffix - 1]
  ) {
    matchingSuffix++;
  }

  return vscode.TextEdit.replace(
    new vscode.Range(document.positionAt(start), document.positionAt(source.length - matchingSuffix)),
    formatted.slice(start, formatted.length - matchingSuffix),
  );
}

function quoteArgument(argument: string): string {
  return /\s/.test(argument) ? JSON.stringify(argument) : argument;
}

function resolveConfiguredPath(filepath: string, cwd: string): string {
  if (filepath === "~") return homedir();
  if (filepath.startsWith("~/") || filepath.startsWith("~\\")) return resolve(homedir(), filepath.slice(2));
  return isAbsolute(filepath) ? filepath : resolve(cwd, filepath);
}

async function findActiveBunfig(startDirectory: string): Promise<BunfigInspection> {
  let directory = startDirectory;
  while (true) {
    const result = await inspectBunfig(join(directory, "bunfig.toml"), false);
    if (result.path) return result;

    const parent = dirname(directory);
    if (parent === directory) return {};
    directory = parent;
  }
}

interface BunfigInspection {
  path?: string;
  problem?: string;
}

async function inspectBunfig(filepath: string, configured: boolean): Promise<BunfigInspection> {
  try {
    const contents = await readFile(filepath, "utf8");
    if (/^\s*\[\[?fmt(?:\]|\.)/m.test(contents)) return { path: filepath };
    return configured ? { problem: `${filepath} does not contain a [fmt] section.` } : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return configured ? { problem: `Configured bunfig.toml was not found: ${filepath}` } : {};
    }
    const message = error instanceof Error ? error.message : String(error);
    return configured ? { problem: `Could not read ${filepath}: ${message}` } : {};
  }
}
