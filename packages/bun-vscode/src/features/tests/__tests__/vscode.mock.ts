import { mock } from "bun:test";
import {
  MockConfiguration,
  MockDisposable,
  MockFileSystemWatcher,
  MockLocation,
  MockMarkdownString,
  MockPosition,
  MockRange,
  MockRelativePattern,
  MockTestController,
  MockTestMessage,
  MockTestRunProfileKind,
  MockTestTag,
  MockUri,
  MockWorkspaceFolder,
} from "./vscode-types.mock";

export interface MockTextDocumentLike {
  uri: MockUri;
  languageId: string;
}

export interface MockConfigurationChangeEvent {
  affectsConfiguration(section: string, scope?: unknown): boolean;
}

export type MockFindFiles = (
  include: string | MockRelativePattern,
  exclude?: string | null,
  maxResults?: number,
  token?: unknown,
) => Promise<MockUri[]>;

/**
 * Mutable state behind the `vscode` mock. It is shared by every test file in the
 * process, so tests that change it must call `resetVscodeMock()` when they are done.
 */
export const vscodeMockState = {
  /** Full configuration keys, e.g. "bun.runtime" -> "/usr/bin/bun". */
  configuration: new Map<string, unknown>(),
  workspaceFolders: undefined as MockWorkspaceFolder[] | undefined,
  textDocuments: [] as MockTextDocumentLike[],
  openDocumentListeners: [] as ((document: MockTextDocumentLike) => unknown)[],
  configurationChangeListeners: [] as ((event: MockConfigurationChangeEvent) => unknown)[],
  findFiles: (async () => []) as MockFindFiles,
  /** Lines appended to each output channel, keyed by channel name. */
  outputChannels: new Map<string, string[]>(),
  /** Messages passed to window.show{Error,Warning,Information}Message. */
  messages: [] as { kind: "error" | "warning" | "information"; message: string }[],
};

export function resetVscodeMock(): void {
  vscodeMockState.configuration.clear();
  vscodeMockState.workspaceFolders = undefined;
  vscodeMockState.textDocuments.length = 0;
  vscodeMockState.openDocumentListeners.length = 0;
  vscodeMockState.configurationChangeListeners.length = 0;
  vscodeMockState.findFiles = async () => [];
  vscodeMockState.outputChannels.clear();
  vscodeMockState.messages.length = 0;
}

export function setConfiguration(key: string, value: unknown): void {
  if (value === undefined) {
    vscodeMockState.configuration.delete(key);
  } else {
    vscodeMockState.configuration.set(key, value);
  }
}

export function getOutputLines(channelName: string): string[] {
  let lines = vscodeMockState.outputChannels.get(channelName);
  if (!lines) {
    lines = [];
    vscodeMockState.outputChannels.set(channelName, lines);
  }
  return lines;
}

/** Adds the document to `workspace.textDocuments` and notifies every open-document listener. */
export async function openTextDocument(document: MockTextDocumentLike): Promise<void> {
  vscodeMockState.textDocuments.push(document);
  await Promise.all(vscodeMockState.openDocumentListeners.map(listener => listener(document)));
}

export async function fireConfigurationChange(changedKeys: string[]): Promise<void> {
  const event: MockConfigurationChangeEvent = {
    affectsConfiguration(section: string): boolean {
      return changedKeys.some(key => key === section || key.startsWith(`${section}.`) || section.startsWith(`${key}.`));
    },
  };
  await Promise.all(vscodeMockState.configurationChangeListeners.map(listener => listener(event)));
}

/**
 * Configuration view over `vscodeMockState.configuration` for one section, so that both
 * `getConfiguration("bun").get("lsp.enable")` and `getConfiguration("bun.lsp").get("enable")`
 * read the same "bun.lsp.enable" entry.
 */
class MockSectionConfiguration extends MockConfiguration {
  constructor(private readonly section?: string) {
    super();
  }

  private fullKey(key: string): string {
    return this.section ? `${this.section}.${key}` : key;
  }

  override get<T>(key: string, defaultValue?: T): T | undefined {
    const value = vscodeMockState.configuration.get(this.fullKey(key)) as T | undefined;
    return value ?? defaultValue;
  }

  override has(key: string): boolean {
    return vscodeMockState.configuration.has(this.fullKey(key));
  }

  override inspect<T>(key: string) {
    return {
      key: this.fullKey(key),
      defaultValue: undefined,
      globalValue: vscodeMockState.configuration.get(this.fullKey(key)) as T | undefined,
      workspaceValue: undefined,
      workspaceFolderValue: undefined,
    };
  }

  override async update(key: string, value: unknown): Promise<void> {
    setConfiguration(this.fullKey(key), value);
  }

  override setValue(key: string, value: unknown): void {
    setConfiguration(this.fullKey(key), value);
  }
}

function addListener<T>(
  listeners: ((event: T) => unknown)[],
  listener: (event: T) => unknown,
  thisArg?: unknown,
  disposables?: { push(disposable: MockDisposable): unknown },
): MockDisposable {
  const bound = thisArg ? listener.bind(thisArg) : listener;
  listeners.push(bound);
  const disposable = new MockDisposable(() => {
    const index = listeners.indexOf(bound);
    if (index >= 0) listeners.splice(index, 1);
  });
  disposables?.push(disposable);
  return disposable;
}

function createOutputChannel(name: string) {
  return {
    name,
    append: (value: string) => {
      getOutputLines(name).push(value);
    },
    appendLine: (line: string) => {
      getOutputLines(name).push(line);
    },
    replace: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
  };
}

function showMessage(kind: "error" | "warning" | "information") {
  return async (message: string) => {
    vscodeMockState.messages.push({ kind, message });
    return undefined;
  };
}

mock.module("vscode", () => ({
  window: {
    createOutputChannel,
    showErrorMessage: showMessage("error"),
    showWarningMessage: showMessage("warning"),
    showInformationMessage: showMessage("information"),
    visibleTextEditors: [],
  },
  workspace: {
    getConfiguration: (section?: string) => new MockSectionConfiguration(section),
    get workspaceFolders() {
      return vscodeMockState.workspaceFolders;
    },
    getWorkspaceFolder: (uri: MockUri) => {
      const path = uri.fsPath ?? uri.path;
      return vscodeMockState.workspaceFolders?.find(folder => {
        const base = folder.uri.fsPath;
        return path === base || path.startsWith(base.endsWith("/") ? base : `${base}/`);
      });
    },
    onDidOpenTextDocument: (
      listener: (document: MockTextDocumentLike) => unknown,
      thisArg?: unknown,
      disposables?: MockDisposable[],
    ) => addListener(vscodeMockState.openDocumentListeners, listener, thisArg, disposables),
    onDidChangeConfiguration: (
      listener: (event: MockConfigurationChangeEvent) => unknown,
      thisArg?: unknown,
      disposables?: MockDisposable[],
    ) => addListener(vscodeMockState.configurationChangeListeners, listener, thisArg, disposables),
    get textDocuments() {
      return vscodeMockState.textDocuments;
    },
    createFileSystemWatcher: (pattern: string | MockRelativePattern) => new MockFileSystemWatcher(),
    findFiles: (include: string | MockRelativePattern, exclude?: string | null, maxResults?: number, token?: any) =>
      vscodeMockState.findFiles(include, exclude, maxResults, token),
  },
  Uri: MockUri,
  TestTag: MockTestTag,
  Position: MockPosition,
  Range: MockRange,
  Location: MockLocation,
  TestMessage: MockTestMessage,
  MarkdownString: MockMarkdownString,
  TestRunProfileKind: MockTestRunProfileKind,
  RelativePattern: MockRelativePattern,
  debug: {
    addBreakpoints: () => {},
    startDebugging: async () => true,
  },
}));

export function makeTestController(): MockTestController {
  return new MockTestController("test-controller", "Test Controller");
}

export function makeWorkspaceFolder(path: string): MockWorkspaceFolder {
  return new MockWorkspaceFolder(MockUri.file(path), path.split("/").pop() || "workspace", 0);
}
