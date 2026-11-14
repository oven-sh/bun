import { mock } from "bun:test";
import { isAbsolute, relative } from "node:path";
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

type ConfigurationChangeListener = (event: { affectsConfiguration(section: string): boolean }) => void;

// One configuration per section, so the next `getConfiguration()` sees an `update()`.
const configurations = new Map<string, MockConfiguration>();
const configurationListeners = new Set<ConfigurationChangeListener>();
const workspaceFolders: MockWorkspaceFolder[] = [];

function getConfiguration(section: string = ""): MockConfiguration {
  let configuration = configurations.get(section);
  if (!configuration) {
    configuration = new MockConfiguration(key => {
      const changed = section ? `${section}.${key}` : key;
      const event = { affectsConfiguration: (name: string) => changed === name || changed.startsWith(`${name}.`) };
      for (const listener of configurationListeners) listener(event);
    });
    configurations.set(section, configuration);
  }
  return configuration;
}

// A stand-in for `score()` in VS Code's languageSelector.ts. Bun.Glob takes the place of VS Code's glob.ts.
function matchDocument(
  selector: { scheme?: string; pattern?: string | MockRelativePattern },
  document: { uri: MockUri },
): number {
  let score = 0;
  if (selector.scheme) {
    if (selector.scheme !== document.uri.scheme) return 0;
    score = 10;
  }
  const { pattern } = selector;
  if (pattern) {
    let target = document.uri.fsPath;
    if (typeof pattern !== "string") {
      target = relative(pattern.baseUri.fsPath, target);
      if (target.startsWith("..") || isAbsolute(target)) return 0;
    }
    const glob = typeof pattern === "string" ? pattern : pattern.pattern;
    if (!new Bun.Glob(glob).match(target.replaceAll("\\", "/"))) return 0;
    score = 10;
  }
  return score;
}

mock.module("vscode", () => ({
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
    }),
    showInformationMessage: async (message: string, ...items: string[]): Promise<string | undefined> => undefined,
    visibleTextEditors: [],
  },
  commands: {
    executeCommand: async (command: string, ...rest: unknown[]) => {},
  },
  workspace: {
    getConfiguration,
    onDidChangeConfiguration: (
      listener: ConfigurationChangeListener,
      thisArgs?: unknown,
      disposables?: MockDisposable[],
    ) => {
      const bound = listener.bind(thisArgs);
      configurationListeners.add(bound);
      const disposable = new MockDisposable(() => configurationListeners.delete(bound));
      disposables?.push(disposable);
      return disposable;
    },
    getWorkspaceFolder: ({ fsPath }: MockUri) =>
      workspaceFolders.find(({ uri }) => {
        const base = uri.fsPath;
        return fsPath === base || (fsPath.startsWith(base) && /[\\/]/.test(fsPath[base.length]));
      }),
    onDidOpenTextDocument: () => new MockDisposable(),
    textDocuments: [],
    createFileSystemWatcher: (pattern: string | MockRelativePattern) => new MockFileSystemWatcher(),
    findFiles: async (include: string, exclude?: string, maxResults?: number, token?: any) => {
      return []; // Mock implementation
    },
  },
  languages: {
    match: matchDocument,
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
  const folder = new MockWorkspaceFolder(MockUri.file(path), path.split("/").pop() || "workspace", 0);
  workspaceFolders.push(folder);
  return folder;
}
