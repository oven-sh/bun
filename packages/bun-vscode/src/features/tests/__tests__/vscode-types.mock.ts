/**
 * Mock VSCode types and classes for testing
 * These should be as close as possible to the real VSCode API
 */

export interface MockUri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly fsPath: string;
  toString(): string;
}

export class MockUri implements MockUri {
  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
    public readonly fsPath: string,
  ) {}

  static file(path: string): MockUri {
    return new MockUri("file", "", path, "", "", path);
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

export class MockPosition {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class MockRange {
  constructor(
    public readonly start: MockPosition,
    public readonly end: MockPosition,
  ) {}
}

export class MockLocation {
  constructor(
    public readonly uri: MockUri,
    public readonly range: MockRange,
  ) {}
}

export class MockTestTag {
  constructor(public readonly id: string) {}
}

export class MockTestMessage {
  public location?: MockLocation;
  public actualOutput?: string;
  public expectedOutput?: string;

  constructor(public message: string | MockMarkdownString) {}

  static diff(message: string, expected: string, actual: string): MockTestMessage {
    const msg = new MockTestMessage(message);
    msg.expectedOutput = expected;
    msg.actualOutput = actual;
    return msg;
  }
}

export class MockMarkdownString {
  constructor(public value: string = "") {}

  appendCodeblock(code: string, language?: string): MockMarkdownString {
    this.value += `\n\`\`\`${language || ""}\n${code}\n\`\`\``;
    return this;
  }

  appendMarkdown(value: string): MockMarkdownString {
    this.value += value;
    return this;
  }

  appendText(value: string): MockMarkdownString {
    this.value += value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
    return this;
  }
}

export interface MockTestItem {
  readonly id: string;
  readonly uri?: MockUri;
  readonly children: MockTestItemCollection;
  readonly parent?: MockTestItem;
  label: string;
  description?: string;
  tags: readonly MockTestTag[];
  canResolveChildren: boolean;
  busy: boolean;
  range?: MockRange;
  error?: string | MockMarkdownString;
}

export interface MockTestItemCollection {
  readonly size: number;
  add(item: MockTestItem): void;
  replace(items: readonly MockTestItem[]): void;
  forEach(callback: (item: MockTestItem, id: string, collection: MockTestItemCollection) => void): void;
  get(itemId: string): MockTestItem | undefined;
  delete(itemId: string): void;
  [Symbol.iterator](): Iterator<[string, MockTestItem]>;
}

export class MockTestItemCollection implements MockTestItemCollection {
  private items = new Map<string, MockTestItem>();

  get size(): number {
    return this.items.size;
  }

  add(item: MockTestItem): void {
    this.items.set(item.id, item);
  }

  replace(items: readonly MockTestItem[]): void {
    this.items.clear();
    for (const item of items) {
      this.items.set(item.id, item);
    }
  }

  forEach(callback: (item: MockTestItem, id: string, collection: MockTestItemCollection) => void): void {
    this.items.forEach((item, id) => callback(item, id, this));
  }

  get(itemId: string): MockTestItem | undefined {
    return this.items.get(itemId);
  }

  delete(itemId: string): void {
    this.items.delete(itemId);
  }

  [Symbol.iterator](): Iterator<[string, MockTestItem]> {
    return this.items[Symbol.iterator]();
  }

  clear(): void {
    this.items.clear();
  }

  set(id: string, item: MockTestItem): void {
    this.items.set(id, item);
  }

  values(): IterableIterator<MockTestItem> {
    return this.items.values();
  }

  keys(): IterableIterator<string> {
    return this.items.keys();
  }

  entries(): IterableIterator<[string, MockTestItem]> {
    return this.items.entries();
  }
}

export class MockTestItem implements MockTestItem {
  public canResolveChildren: boolean = false;
  public busy: boolean = false;
  public description?: string;
  public range?: MockRange;
  public error?: string | MockMarkdownString;
  public readonly children: MockTestItemCollection;

  constructor(
    public readonly id: string,
    public label: string,
    public readonly uri?: MockUri,
    public readonly parent?: MockTestItem,
    public tags: readonly MockTestTag[] = [],
  ) {
    this.children = new MockTestItemCollection();
  }
}

export interface MockTestController {
  readonly items: MockTestItemCollection;
  createTestItem(id: string, label: string, uri?: MockUri): MockTestItem;
  createRunProfile(
    label: string,
    kind: MockTestRunProfileKind,
    runHandler: (request: MockTestRunRequest, token: MockCancellationToken) => void | Promise<void>,
    isDefault?: boolean,
  ): MockTestRunProfile;
  createTestRun(request: MockTestRunRequest, name?: string, persist?: boolean): MockTestRun;
  invalidateTestResults(items?: readonly MockTestItem[]): void;
  resolveHandler?: (item: MockTestItem | undefined) => Promise<void> | void;
  refreshHandler?: (token?: MockCancellationToken) => Promise<void> | void;
}

export class MockTestController implements MockTestController {
  public readonly items: MockTestItemCollection;
  public resolveHandler?: (item: MockTestItem | undefined) => Promise<void> | void;
  public refreshHandler?: (token?: MockCancellationToken) => Promise<void> | void;

  constructor(
    public readonly id: string,
    public readonly label: string,
  ) {
    this.items = new MockTestItemCollection();
  }

  createTestItem(id: string, label: string, uri?: MockUri): MockTestItem {
    return new MockTestItem(id, label, uri);
  }

  createRunProfile(
    label: string,
    kind: MockTestRunProfileKind,
    runHandler: (request: MockTestRunRequest, token: MockCancellationToken) => void | Promise<void>,
    isDefault?: boolean,
  ): MockTestRunProfile {
    return new MockTestRunProfile(label, kind, runHandler, isDefault);
  }

  createTestRun(request: MockTestRunRequest, name?: string, persist?: boolean): MockTestRun {
    return new MockTestRun(name, persist);
  }

  invalidateTestResults(items?: readonly MockTestItem[]): void {
    // Mock implementation - in real VSCode this would invalidate test results
  }

  dispose(): void {
    this.items.clear();
  }
}

export enum MockTestRunProfileKind {
  Run = 1,
  Debug = 2,
  Coverage = 3,
}

export interface MockTestRunProfile {
  readonly label: string;
  readonly kind: MockTestRunProfileKind;
  readonly isDefault: boolean;
  readonly runHandler: (request: MockTestRunRequest, token: MockCancellationToken) => void | Promise<void>;
  dispose(): void;
}

export class MockTestRunProfile implements MockTestRunProfile {
  constructor(
    public readonly label: string,
    public readonly kind: MockTestRunProfileKind,
    public readonly runHandler: (request: MockTestRunRequest, token: MockCancellationToken) => void | Promise<void>,
    public readonly isDefault: boolean = false,
  ) {}

  dispose(): void {
    // No-op for mock
  }
}

export interface MockTestRunRequest {
  readonly include?: readonly MockTestItem[];
  readonly exclude?: readonly MockTestItem[];
  readonly profile?: MockTestRunProfile;
}

export class MockTestRunRequest implements MockTestRunRequest {
  constructor(
    public readonly include?: readonly MockTestItem[],
    public readonly exclude?: readonly MockTestItem[],
    public readonly profile?: MockTestRunProfile,
  ) {}
}

export interface MockTestRun {
  readonly name?: string;
  readonly token: MockCancellationToken;
  appendOutput(output: string, location?: MockLocation, test?: MockTestItem): void;
  end(): void;
  enqueued(test: MockTestItem): void;
  errored(test: MockTestItem, message: MockTestMessage | readonly MockTestMessage[], duration?: number): void;
  failed(test: MockTestItem, message: MockTestMessage | readonly MockTestMessage[], duration?: number): void;
  passed(test: MockTestItem, duration?: number): void;
  skipped(test: MockTestItem): void;
  started(test: MockTestItem): void;
}

export class MockTestRun implements MockTestRun {
  public readonly token: MockCancellationToken;
  private _ended: boolean = false;

  constructor(
    public readonly name?: string,
    public readonly persist: boolean = true,
  ) {
    this.token = new MockCancellationToken();
  }

  appendOutput(output: string, location?: MockLocation, test?: MockTestItem): void {
    if (this._ended) return;
    // For mock, just store output - in real VS Code this would appear in test output
  }

  end(): void {
    this._ended = true;
  }

  enqueued(test: MockTestItem): void {
    if (this._ended) return;
    // Mock implementation
  }

  errored(test: MockTestItem, message: MockTestMessage | readonly MockTestMessage[], duration?: number): void {
    if (this._ended) return;
    // Mock implementation
  }

  failed(test: MockTestItem, message: MockTestMessage | readonly MockTestMessage[], duration?: number): void {
    if (this._ended) return;
    // Mock implementation
  }

  passed(test: MockTestItem, duration?: number): void {
    if (this._ended) return;
    // Mock implementation
  }

  skipped(test: MockTestItem): void {
    if (this._ended) return;
    // Mock implementation
  }

  started(test: MockTestItem): void {
    if (this._ended) return;
    // Mock implementation
  }
}

export interface MockCancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): MockDisposable;
}

export class MockCancellationToken implements MockCancellationToken {
  private _isCancellationRequested: boolean = false;
  private _listeners: (() => void)[] = [];

  get isCancellationRequested(): boolean {
    return this._isCancellationRequested;
  }

  onCancellationRequested(listener: () => void): MockDisposable {
    this._listeners.push(listener);
    return new MockDisposable(() => {
      const index = this._listeners.indexOf(listener);
      if (index >= 0) {
        this._listeners.splice(index, 1);
      }
    });
  }

  cancel(): void {
    this._isCancellationRequested = true;
    this._listeners.forEach(listener => listener());
  }
}

export interface MockDisposable {
  dispose(): void;
}

export class MockDisposable implements MockDisposable {
  constructor(private readonly disposeFunc?: () => void) {}

  dispose(): void {
    this.disposeFunc?.();
  }
}

export interface MockTextDocument {
  readonly uri: MockUri;
  readonly fileName: string;
  readonly isUntitled: boolean;
  readonly languageId: string;
  readonly version: number;
  readonly isDirty: boolean;
  readonly isClosed: boolean;
  readonly eol: MockEndOfLine;
  readonly lineCount: number;
  getText(range?: MockRange): string;
  getWordRangeAtPosition(position: MockPosition, regex?: RegExp): MockRange | undefined;
  lineAt(line: number | MockPosition): MockTextLine;
  offsetAt(position: MockPosition): number;
  positionAt(offset: number): MockPosition;
  save(): Promise<boolean>;
  validatePosition(position: MockPosition): MockPosition;
  validateRange(range: MockRange): MockRange;
}

export enum MockEndOfLine {
  LF = 1,
  CRLF = 2,
}

export interface MockTextLine {
  readonly lineNumber: number;
  readonly text: string;
  readonly range: MockRange;
  readonly rangeIncludingLineBreak: MockRange;
  readonly firstNonWhitespaceCharacterIndex: number;
  readonly isEmptyOrWhitespace: boolean;
}

export interface MockWorkspaceFolder {
  readonly uri: MockUri;
  readonly name: string;
  readonly index: number;
}

export class MockWorkspaceFolder implements MockWorkspaceFolder {
  constructor(
    public readonly uri: MockUri,
    public readonly name: string,
    public readonly index: number = 0,
  ) {}
}

export interface MockFileSystemWatcher extends MockDisposable {
  readonly ignoreCreateEvents: boolean;
  readonly ignoreChangeEvents: boolean;
  readonly ignoreDeleteEvents: boolean;
  onDidCreate(listener: (uri: MockUri) => void): MockDisposable;
  onDidChange(listener: (uri: MockUri) => void): MockDisposable;
  onDidDelete(listener: (uri: MockUri) => void): MockDisposable;
}

export class MockFileSystemWatcher implements MockFileSystemWatcher {
  public readonly ignoreCreateEvents: boolean = false;
  public readonly ignoreChangeEvents: boolean = false;
  public readonly ignoreDeleteEvents: boolean = false;

  private _createListeners: ((uri: MockUri) => void)[] = [];
  private _changeListeners: ((uri: MockUri) => void)[] = [];
  private _deleteListeners: ((uri: MockUri) => void)[] = [];

  onDidCreate(listener: (uri: MockUri) => void): MockDisposable {
    this._createListeners.push(listener);
    return new MockDisposable(() => {
      const index = this._createListeners.indexOf(listener);
      if (index >= 0) this._createListeners.splice(index, 1);
    });
  }

  onDidChange(listener: (uri: MockUri) => void): MockDisposable {
    this._changeListeners.push(listener);
    return new MockDisposable(() => {
      const index = this._changeListeners.indexOf(listener);
      if (index >= 0) this._changeListeners.splice(index, 1);
    });
  }

  onDidDelete(listener: (uri: MockUri) => void): MockDisposable {
    this._deleteListeners.push(listener);
    return new MockDisposable(() => {
      const index = this._deleteListeners.indexOf(listener);
      if (index >= 0) this._deleteListeners.splice(index, 1);
    });
  }

  dispose(): void {
    this._createListeners.length = 0;
    this._changeListeners.length = 0;
    this._deleteListeners.length = 0;
  }

  // Helper methods for testing
  triggerCreate(uri: MockUri): void {
    this._createListeners.forEach(listener => listener(uri));
  }

  triggerChange(uri: MockUri): void {
    this._changeListeners.forEach(listener => listener(uri));
  }

  triggerDelete(uri: MockUri): void {
    this._deleteListeners.forEach(listener => listener(uri));
  }
}

export interface MockRelativePattern {
  readonly base: string;
  readonly pattern: string;
}

export class MockRelativePattern implements MockRelativePattern {
  constructor(
    public readonly base: string | MockWorkspaceFolder,
    public readonly pattern: string,
  ) {}

  get baseUri(): MockUri {
    if (typeof this.base === "string") {
      return MockUri.file(this.base);
    }
    return this.base.uri;
  }
}

export interface MockConfiguration {
  get<T>(section: string, defaultValue?: T): T | undefined;
  has(section: string): boolean;
  inspect<T>(section: string): MockConfigurationInspect<T> | undefined;
  update(section: string, value: any, configurationTarget?: MockConfigurationTarget): Promise<void>;
}

export interface MockConfigurationInspect<T> {
  readonly key: string;
  readonly defaultValue?: T;
  readonly globalValue?: T;
  readonly workspaceValue?: T;
  readonly workspaceFolderValue?: T;
}

export enum MockConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export class MockConfiguration implements MockConfiguration {
  private _values = new Map<string, any>();

  get<T>(section: string, defaultValue?: T): T | undefined {
    return this._values.get(section) ?? defaultValue;
  }

  has(section: string): boolean {
    return this._values.has(section);
  }

  inspect<T>(section: string): MockConfigurationInspect<T> | undefined {
    return {
      key: section,
      defaultValue: undefined,
      globalValue: this._values.get(section),
      workspaceValue: undefined,
      workspaceFolderValue: undefined,
    };
  }

  async update(section: string, value: any, configurationTarget?: MockConfigurationTarget): Promise<void> {
    this._values.set(section, value);
  }

  // Helper for testing
  setValue(section: string, value: any): void {
    this._values.set(section, value);
  }
}
