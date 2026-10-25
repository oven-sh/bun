import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { CloseAction, ErrorAction, LanguageClient, RevealOutputChannelOn, State } from "vscode-languageclient/node";

export const LSP_LANGUAGE_IDS: readonly string[] = (
  "javascript javascriptreact typescript typescriptreact json jsonc json5 css scss less html " +
  "vue svelte astro markdown mdx yaml graphql handlebars toml"
).split(" ");

export const MARKER_GLOB = "**/{bunfig.toml,bun.lock,bun.lockb}";

// First release that ships `bun fmt --lsp`.
export const MIN_BUN_VERSION = "1.4.5";

export interface LanguageClientLike {
  readonly state: State;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ServerSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export interface ClientHooks {
  onClosed(): void;
}

export interface LanguageServerOptions {
  createClient?: (server: ServerSpec, hooks: ClientHooks) => LanguageClientLike;
}

let output: vscode.OutputChannel | undefined;
let client: LanguageClientLike | undefined;
let starting: Promise<void> | undefined;
let wanted = false;
let failed = false;
const markerCache = new Map<string, Promise<boolean>>();

function getOutput(): vscode.OutputChannel {
  return (output ??= vscode.window.createOutputChannel("Bun"));
}

function getRuntime(): string {
  const value = vscode.workspace.getConfiguration("bun").get<string>("runtime");
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "bun";
}

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration("bun").get<boolean>("lsp.enable", true);
}

// vscode-languageclient forces a popup when start() fails, even with
// revealOutputChannelOn: Never. The output channel already has the details.
class QuietLanguageClient extends LanguageClient {
  override error(message: string, data?: unknown, _showNotification?: boolean | "force"): void {
    super.error(message, data, false);
  }
}

function defaultCreateClient(server: ServerSpec, hooks: ClientHooks): LanguageClientLike {
  const bun = vscode.workspace.getConfiguration("bun");
  const initializationOptions = {
    lint: {
      enable: bun.get<boolean>("lint.enable", true),
      run: bun.get<string>("lint.run", "onType"),
    },
    format: {
      enable: bun.get<boolean>("format.enable", true),
    },
  };
  return new QuietLanguageClient(
    "bun",
    "Bun",
    // No `transport`: vscode-languageclient talks stdio by default and, unlike
    // TransportKind.stdio, does not append a `--stdio` flag that bun fmt would reject.
    {
      command: server.command,
      args: server.args,
      options: { cwd: server.cwd },
    },
    {
      documentSelector: LSP_LANGUAGE_IDS.flatMap(language => [
        { scheme: "file", language },
        { scheme: "untitled", language },
      ]),
      initializationOptions,
      synchronize: { configurationSection: ["bun.lint", "bun.format"] },
      outputChannel: getOutput(),
      revealOutputChannelOn: RevealOutputChannelOn.Never,
      initializationFailedHandler: () => false,
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue, handled: true }),
        closed: () => {
          hooks.onClosed();
          return { action: CloseAction.DoNotRestart, handled: true };
        },
      },
    },
  );
}

async function startLanguageServer(options: LanguageServerOptions): Promise<void> {
  const runtime = getRuntime();
  const spec: ServerSpec = {
    command: runtime,
    args: ["fmt", "--no-script", "--lsp"],
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  };
  try {
    let next: LanguageClientLike | undefined;
    const hooks: ClientHooks = {
      // vscode-languageclient calls errorHandler.closed after a Running server exits,
      // but not during its own stop(). A close during startup is left to the
      // state !== Running check below; here `starting` is still set.
      onClosed() {
        if (starting || client !== next) return;
        client = undefined;
        getOutput().appendLine(
          "The Bun language server exited; it starts again the next time a supported file is opened",
        );
      },
    };
    next = (options.createClient ?? defaultCreateClient)(spec, hooks);
    client = next;
    await next.start();
    // start() resolves instead of rejecting when the server exits before answering initialize.
    if (next.state !== State.Running) throw new Error("the server exited during startup");
  } catch (error) {
    client = undefined;
    failed = true;
    getOutput().appendLine(
      `Failed to start the Bun language server: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function ensureStarted(options: LanguageServerOptions): Promise<void> {
  if (client || failed || starting) return starting ?? Promise.resolve();
  starting = startLanguageServer(options).finally(() => {
    starting = undefined;
  });
  return starting;
}

function hasMarker(folder: vscode.WorkspaceFolder): Promise<boolean> {
  const key = folder.uri.toString();
  let cached = markerCache.get(key);
  if (!cached) {
    cached = Promise.resolve(
      vscode.workspace.findFiles(new vscode.RelativePattern(folder, MARKER_GLOB), "**/node_modules/**", 1),
    ).then(
      hits => hits.length > 0,
      () => false,
    );
    markerCache.set(key, cached);
  }
  return cached;
}

async function qualifies(document: vscode.TextDocument): Promise<boolean> {
  if (!isEnabled()) return false;
  if (document.uri.scheme !== "file" || !LSP_LANGUAGE_IDS.includes(document.languageId)) return false;
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  return folder !== undefined && (await hasMarker(folder));
}

async function onDocument(document: vscode.TextDocument, options: LanguageServerOptions): Promise<void> {
  if (!(await qualifies(document))) return;
  wanted = true;
  await ensureStarted(options);
}

function scanOpenDocuments(options: LanguageServerOptions): void {
  for (const document of vscode.workspace.textDocuments) {
    void onDocument(document, options);
  }
}

export async function stopLanguageServer(): Promise<void> {
  if (starting) await starting;
  const current = client;
  client = undefined;
  if (current) await current.stop().catch(() => {});
}

export function registerLanguageServer(context: vscode.ExtensionContext, options: LanguageServerOptions = {}): void {
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => onDocument(document, options)),
    vscode.workspace.onDidChangeConfiguration(async event => {
      const runtimeChanged = event.affectsConfiguration("bun.runtime");
      const enableChanged = event.affectsConfiguration("bun.lsp.enable");
      if (!runtimeChanged && !enableChanged) return;
      if (!isEnabled()) {
        await stopLanguageServer();
        return;
      }
      if (runtimeChanged) await stopLanguageServer();
      failed = false;
      if (wanted) {
        await ensureStarted(options);
        return;
      }
      // Documents opened while the setting was off never set `wanted`, and VS Code
      // does not re-fire onDidOpenTextDocument for them.
      if (enableChanged) scanOpenDocuments(options);
    }),
  );
  scanOpenDocuments(options);
}
