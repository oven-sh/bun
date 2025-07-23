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

mock.module("vscode", () => ({
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
    }),
    visibleTextEditors: [],
  },
  workspace: {
    getConfiguration: (section?: string) => new MockConfiguration(),
    onDidOpenTextDocument: () => new MockDisposable(),
    textDocuments: [],
    createFileSystemWatcher: (pattern: string | MockRelativePattern) => new MockFileSystemWatcher(),
    findFiles: async (include: string, exclude?: string, maxResults?: number, token?: any) => {
      return []; // Mock implementation
    },
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
