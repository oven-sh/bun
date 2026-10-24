import { execFile } from "node:child_process";
import * as vscode from "vscode";
import {
  CloseAction,
  ErrorAction,
  LanguageClient,
  RevealOutputChannelOn,
  TransportKind,
} from "vscode-languageclient/node";

export const LSP_LANGUAGE_IDS: readonly string[] = (
  "javascript javascriptreact typescript typescriptreact json jsonc json5 css scss less html " +
  "vue svelte astro markdown mdx yaml graphql handlebars toml"
).split(" ");

export const MARKER_GLOB = "**/{bunfig.toml,bun.lock,bun.lockb}";

// Placeholder until the release that ships `bun fmt --lsp` is known.
const MIN_BUN_VERSION = "1.4.4";

export interface LanguageClientLike {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ServerSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export interface LanguageServerOptions {
  createClient?: (server: ServerSpec) => LanguageClientLike;
  checkRuntime?: (runtime: string) => Promise<string | undefined>;
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

function parseVersion(text: string): number[] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function isAtLeast(actual: number[], minimum: number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

function defaultCheckRuntime(runtime: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile(runtime, ["--version"], (error, stdout) => {
      if (error) return resolve(`could not run ${runtime} --version: ${error.message}`);
      const actual = parseVersion(String(stdout));
      if (!actual) return resolve(`could not parse the output of ${runtime} --version: ${String(stdout).trim()}`);
      if (isAtLeast(actual, parseVersion(MIN_BUN_VERSION)!)) return resolve(undefined);
      resolve(`bun fmt --lsp needs Bun ${MIN_BUN_VERSION} or later, found ${actual.join(".")}`);
    });
  });
}

function defaultCreateClient(server: ServerSpec): LanguageClientLike {
  const bun = vscode.workspace.getConfiguration("bun");
  const initializationOptions: Record<string, unknown> = {};
  for (const key of ["lint", "format"]) {
    const value = bun.get(key);
    if (value !== undefined) initializationOptions[key] = value;
  }
  return new LanguageClient(
    "bun",
    "Bun",
    {
      command: server.command,
      args: server.args,
      transport: TransportKind.stdio,
      options: { cwd: server.cwd },
    },
    {
      documentSelector: LSP_LANGUAGE_IDS.flatMap(language => [
        { scheme: "file", language },
        { scheme: "untitled", language },
      ]),
      initializationOptions,
      synchronize: { configurationSection: "bun" },
      outputChannel: getOutput(),
      revealOutputChannelOn: RevealOutputChannelOn.Never,
      initializationFailedHandler: () => false,
      errorHandler: {
        error: () => ({ action: ErrorAction.Shutdown, handled: true }),
        closed: () => ({ action: CloseAction.DoNotRestart, handled: true }),
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
    const problem = await (options.checkRuntime ?? defaultCheckRuntime)(runtime);
    if (problem !== undefined) throw new Error(problem);
    const next = (options.createClient ?? defaultCreateClient)(spec);
    client = next;
    await next.start();
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
      if (wanted) await ensureStarted(options);
    }),
  );
  for (const document of vscode.workspace.textDocuments) {
    void onDocument(document, options);
  }
}
