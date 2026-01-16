// Hardcoded module "git"

let Repository: any;
let internalInitialized = false;

function initializeGit() {
  if (internalInitialized) return;
  ({ 0: Repository } = $cpp("git/JSGitRepository.cpp", "createJSGitRepositoryConstructor"));
  internalInitialized = true;
}

class RepositoryWrapper {
  #internal: any;

  constructor(path?: string) {
    initializeGit();
    this.#internal = new Repository(path);
  }

  static find(startPath?: string): RepositoryWrapper | null {
    initializeGit();
    const internal = Repository.find(startPath);
    if (!internal) return null;
    const wrapper = Object.create(RepositoryWrapper.prototype);
    wrapper.#internal = internal;
    return wrapper;
  }

  static init(path: string, options?: { bare?: boolean; initialBranch?: string }): RepositoryWrapper {
    initializeGit();
    const internal = Repository.init(path, options);
    const wrapper = Object.create(RepositoryWrapper.prototype);
    wrapper.#internal = internal;
    return wrapper;
  }

  static clone(url: string, targetPath: string, options?: CloneOptions): RepositoryWrapper {
    initializeGit();
    const internal = Repository.clone(url, targetPath, options);
    const wrapper = Object.create(RepositoryWrapper.prototype);
    wrapper.#internal = internal;
    return wrapper;
  }

  get path(): string {
    return this.#internal.path;
  }

  get gitDir(): string {
    return this.#internal.gitDir;
  }

  get isBare(): boolean {
    return this.#internal.isBare;
  }

  get head(): Commit | null {
    const internal = this.#internal.head;
    if (!internal) return null;
    return wrapCommit(internal, this);
  }

  get branch(): Branch | null {
    const internal = this.#internal.branch;
    if (!internal) return null;
    return wrapBranch(internal, this);
  }

  get isClean(): boolean {
    return this.#internal.isClean;
  }

  get config(): Config {
    return wrapConfig(this.#internal.config, this);
  }

  get index(): Index {
    return wrapIndex(this.#internal.index, this);
  }

  getCommit(ref: string): Commit | null {
    const internal = this.#internal.getCommit(ref);
    if (!internal) return null;
    return wrapCommit(internal, this);
  }

  getBranch(name: string): Branch | null {
    const internal = this.#internal.getBranch(name);
    if (!internal) return null;
    return wrapBranch(internal, this);
  }

  getRemote(name?: string): Remote | null {
    const internal = this.#internal.getRemote(name);
    if (!internal) return null;
    return wrapRemote(internal, this);
  }

  status(options?: StatusOptions): StatusEntry[] {
    const entries = this.#internal.status(options);
    return entries.map((e: any) => new StatusEntry(e));
  }

  diff(options?: DiffOptions): Diff {
    return wrapDiff(this.#internal.diff(options), this);
  }

  add(paths: string | string[]): void {
    this.#internal.add(paths);
  }

  reset(paths?: string | string[]): void {
    this.#internal.reset(paths);
  }

  commit(message: string, options?: CommitOptions): Commit {
    const internal = this.#internal.commit(message, options);
    return wrapCommit(internal, this);
  }

  checkout(ref: string | Branch | Commit, options?: CheckoutOptions): void {
    if (typeof ref === "string") {
      this.#internal.checkout(ref, options);
    } else if (ref instanceof BranchImpl) {
      this.#internal.checkout((ref as any).#internal.name, options);
    } else if (ref instanceof CommitImpl) {
      this.#internal.checkout((ref as any).#internal.sha, options);
    }
  }

  fetch(remoteName?: string, options?: FetchOptions): void {
    this.#internal.fetch(remoteName, options);
  }
}

// Internal wrapper functions
function wrapCommit(internal: any, repo: RepositoryWrapper): Commit {
  const commit = Object.create(CommitImpl.prototype);
  (commit as any).#internal = internal;
  (commit as any).#repo = repo;
  return commit;
}

function wrapBranch(internal: any, repo: RepositoryWrapper): Branch {
  const branch = Object.create(BranchImpl.prototype);
  (branch as any).#internal = internal;
  (branch as any).#repo = repo;
  return branch;
}

function wrapRemote(internal: any, repo: RepositoryWrapper): Remote {
  const remote = Object.create(RemoteImpl.prototype);
  (remote as any).#internal = internal;
  (remote as any).#repo = repo;
  return remote;
}

function wrapConfig(internal: any, repo: RepositoryWrapper): Config {
  const config = Object.create(ConfigImpl.prototype);
  (config as any).#internal = internal;
  (config as any).#repo = repo;
  return config;
}

function wrapIndex(internal: any, repo: RepositoryWrapper): Index {
  const index = Object.create(IndexImpl.prototype);
  (index as any).#internal = internal;
  (index as any).#repo = repo;
  return index;
}

function wrapDiff(internal: any, repo: RepositoryWrapper): Diff {
  const diff = Object.create(DiffImpl.prototype);
  (diff as any).#internal = internal;
  (diff as any).#repo = repo;
  return diff;
}

function wrapBlob(internal: any, repo: RepositoryWrapper): Blob {
  const blob = Object.create(BlobImpl.prototype);
  (blob as any).#internal = internal;
  (blob as any).#repo = repo;
  return blob;
}

// Commit class
class CommitImpl implements Commit {
  #internal: any;
  #repo: RepositoryWrapper;

  get sha(): string {
    return this.#internal.sha;
  }

  get shortSha(): string {
    return this.#internal.shortSha;
  }

  get message(): string {
    return this.#internal.message;
  }

  get summary(): string {
    return this.#internal.summary;
  }

  get author(): Signature {
    return this.#internal.author;
  }

  get committer(): Signature {
    return this.#internal.committer;
  }

  get parents(): Commit[] {
    return this.#internal.parents.map((p: any) => wrapCommit(p, this.#repo));
  }

  get tree(): string {
    return this.#internal.tree;
  }

  parent(n?: number): Commit | null {
    const internal = this.#internal.parent(n);
    if (!internal) return null;
    return wrapCommit(internal, this.#repo);
  }

  diff(other?: Commit | string): Diff {
    let internal;
    if (other instanceof CommitImpl) {
      internal = this.#internal.diff((other as any).#internal);
    } else {
      internal = this.#internal.diff(other);
    }
    return wrapDiff(internal, this.#repo);
  }

  getFile(path: string): Blob | null {
    const internal = this.#internal.getFile(path);
    if (!internal) return null;
    return wrapBlob(internal, this.#repo);
  }

  listFiles(): string[] {
    return this.#internal.listFiles();
  }

  isAncestorOf(other: Commit | string): boolean {
    if (other instanceof CommitImpl) {
      return this.#internal.isAncestorOf((other as any).#internal);
    }
    return this.#internal.isAncestorOf(other);
  }

  distanceTo(other: Commit | string): number {
    // TODO: Implement using git_graph_ahead_behind
    return 0;
  }
}

// Branch class
class BranchImpl implements Branch {
  #internal: any;
  #repo: RepositoryWrapper;

  get name(): string {
    return this.#internal.name;
  }

  get fullName(): string {
    return this.#internal.fullName;
  }

  get isRemote(): boolean {
    return this.#internal.isRemote;
  }

  get isHead(): boolean {
    return this.#internal.isHead;
  }

  get commit(): Commit {
    return wrapCommit(this.#internal.commit, this.#repo);
  }

  get upstream(): Branch | null {
    const internal = this.#internal.upstream;
    if (!internal) return null;
    return wrapBranch(internal, this.#repo);
  }

  get ahead(): number {
    return this.#internal.ahead || 0;
  }

  get behind(): number {
    return this.#internal.behind || 0;
  }

  setUpstream(upstream: Branch | string | null): void {
    this.#internal.setUpstream(upstream);
  }

  delete(force?: boolean): void {
    this.#internal.delete(force);
  }

  rename(newName: string): void {
    this.#internal.rename(newName);
  }

  static create(repo: RepositoryWrapper, name: string, target?: Commit | string): Branch {
    // TODO: Implement
    throw new Error("Not implemented");
  }
}

// Remote class
class RemoteImpl implements Remote {
  #internal: any;
  #repo: RepositoryWrapper;

  get name(): string {
    return this.#internal.name;
  }

  get url(): string {
    return this.#internal.url;
  }

  get pushUrl(): string {
    return this.#internal.pushUrl || this.#internal.url;
  }

  get normalizedUrl(): string {
    return this.#internal.normalizedUrl || this.#internal.url;
  }

  get urlHash(): string {
    return this.#internal.urlHash || "";
  }

  get defaultBranch(): Branch | null {
    const internal = this.#internal.defaultBranch;
    if (!internal) return null;
    return wrapBranch(internal, this.#repo);
  }

  getBranch(name: string): Branch | null {
    const internal = this.#internal.getBranch?.(name);
    if (!internal) return null;
    return wrapBranch(internal, this.#repo);
  }

  listBranches(): Branch[] {
    return (this.#internal.listBranches?.() || []).map((b: any) => wrapBranch(b, this.#repo));
  }

  fetch(options?: FetchOptions): void {
    this.#internal.fetch?.(options);
  }

  fetchBranch(branch: string): void {
    this.#internal.fetchBranch?.(branch);
  }
}

// Config class
class ConfigImpl implements Config {
  #internal: any;
  #repo: RepositoryWrapper;

  get(key: string): string | null {
    return this.#internal.get?.(key) ?? null;
  }

  getAll(key: string): string[] {
    return this.#internal.getAll?.(key) ?? [];
  }

  getBool(key: string): boolean | null {
    return this.#internal.getBool?.(key) ?? null;
  }

  getInt(key: string): number | null {
    return this.#internal.getInt?.(key) ?? null;
  }

  set(key: string, value: string): void {
    this.#internal.set?.(key, value);
  }

  unset(key: string): void {
    this.#internal.unset?.(key);
  }

  get userEmail(): string | null {
    return this.get("user.email");
  }

  set userEmail(value: string | null) {
    if (value === null) {
      this.unset("user.email");
    } else {
      this.set("user.email", value);
    }
  }

  get userName(): string | null {
    return this.get("user.name");
  }

  set userName(value: string | null) {
    if (value === null) {
      this.unset("user.name");
    } else {
      this.set("user.name", value);
    }
  }

  get hooksPath(): string | null {
    return this.get("core.hooksPath");
  }

  set hooksPath(value: string | null) {
    if (value === null) {
      this.unset("core.hooksPath");
    } else {
      this.set("core.hooksPath", value);
    }
  }
}

// Index class
class IndexImpl implements Index {
  #internal: any;
  #repo: RepositoryWrapper;

  get entries(): IndexEntry[] {
    return this.#internal.entries || [];
  }

  add(paths: string | string[]): void {
    this.#internal.add?.(paths);
  }

  addAll(): void {
    this.#internal.addAll?.();
  }

  reset(paths?: string | string[]): void {
    this.#internal.reset?.(paths);
  }

  resetAll(): void {
    this.#internal.resetAll?.();
  }

  has(path: string): boolean {
    return this.#internal.has?.(path) ?? false;
  }

  get(path: string): IndexEntry | null {
    return this.#internal.get?.(path) ?? null;
  }

  diff(): Diff {
    return wrapDiff(this.#internal.diff?.(), this.#repo);
  }
}

// Diff class
class DiffImpl implements Diff {
  #internal: any;
  #repo: RepositoryWrapper;

  get stats(): DiffStats {
    return this.#internal.stats || { filesChanged: 0, insertions: 0, deletions: 0 };
  }

  get files(): DiffFile[] {
    return this.#internal.files || [];
  }

  toString(): string {
    return this.#internal.toString?.() || "";
  }

  toNumstat(): string {
    return this.#internal.toNumstat?.() || "";
  }

  [Symbol.iterator](): Iterator<DiffFile> {
    return this.files[Symbol.iterator]();
  }
}

// Blob class
class BlobImpl implements Blob {
  #internal: any;
  #repo: RepositoryWrapper;

  get sha(): string {
    return this.#internal.sha;
  }

  get size(): number {
    return this.#internal.size;
  }

  get isBinary(): boolean {
    return this.#internal.isBinary;
  }

  content(): Buffer {
    return this.#internal.content?.();
  }

  text(): string {
    return this.#internal.text?.();
  }

  stream(): ReadableStream<Uint8Array> {
    return this.#internal.stream?.();
  }
}

// StatusEntry class
class StatusEntry {
  readonly path: string;
  readonly indexStatus: FileStatus;
  readonly workTreeStatus: FileStatus;
  readonly origPath: string | null;

  constructor(data: any) {
    this.path = data.path;
    this.indexStatus = data.indexStatus;
    this.workTreeStatus = data.workTreeStatus;
    this.origPath = data.origPath || null;
  }

  get isStaged(): boolean {
    return this.indexStatus !== "unmodified";
  }

  get isUnstaged(): boolean {
    return this.workTreeStatus !== "unmodified";
  }

  get isUntracked(): boolean {
    return this.workTreeStatus === "untracked";
  }

  get isConflicted(): boolean {
    return this.indexStatus === "unmerged" || this.workTreeStatus === "unmerged";
  }
}

// Types
type FileStatus =
  | "unmodified"
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "unmerged";

interface Signature {
  readonly name: string;
  readonly email: string;
  readonly date: Date;
  readonly timezone: string;
}

interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

interface DiffFile {
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: "A" | "M" | "D" | "R" | "C" | "T" | "U";
  readonly isBinary: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: DiffHunk[];
  readonly patch: string;
}

interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string;
  readonly lines: DiffLine[];
}

interface DiffLine {
  type: "+" | "-" | " ";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

interface IndexEntry {
  readonly path: string;
  readonly sha: string;
  readonly mode: number;
}

interface CloneOptions {
  depth?: number;
  branch?: string;
  recurseSubmodules?: boolean;
  shallowSubmodules?: boolean;
  bare?: boolean;
}

interface CommitOptions {
  amend?: boolean;
  allowEmpty?: boolean;
  author?: Signature | string;
  noVerify?: boolean;
}

interface CheckoutOptions {
  create?: boolean;
  force?: boolean;
  track?: boolean;
}

interface FetchOptions {
  prune?: boolean;
  tags?: boolean;
  depth?: number;
}

interface DiffOptions {
  cached?: boolean;
  ref?: string | Commit;
  paths?: string[];
  contextLines?: number;
  nameOnly?: boolean;
  nameStatus?: boolean;
  stat?: boolean;
}

interface StatusOptions {
  includeUntracked?: boolean;
  includeIgnored?: boolean;
  noOptionalLocks?: boolean;
}

// Interfaces for public API
interface Commit {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
  readonly summary: string;
  readonly author: Signature;
  readonly committer: Signature;
  readonly parents: Commit[];
  readonly tree: string;
  parent(n?: number): Commit | null;
  diff(other?: Commit | string): Diff;
  getFile(path: string): Blob | null;
  listFiles(): string[];
  isAncestorOf(other: Commit | string): boolean;
  distanceTo(other: Commit | string): number;
}

interface Branch {
  readonly name: string;
  readonly fullName: string;
  readonly isRemote: boolean;
  readonly isHead: boolean;
  readonly commit: Commit;
  readonly upstream: Branch | null;
  readonly ahead: number;
  readonly behind: number;
  setUpstream(upstream: Branch | string | null): void;
  delete(force?: boolean): void;
  rename(newName: string): void;
}

interface Remote {
  readonly name: string;
  readonly url: string;
  readonly pushUrl: string;
  readonly normalizedUrl: string;
  readonly urlHash: string;
  readonly defaultBranch: Branch | null;
  getBranch(name: string): Branch | null;
  listBranches(): Branch[];
  fetch(options?: FetchOptions): void;
  fetchBranch(branch: string): void;
}

interface Config {
  get(key: string): string | null;
  getAll(key: string): string[];
  getBool(key: string): boolean | null;
  getInt(key: string): number | null;
  set(key: string, value: string): void;
  unset(key: string): void;
  userEmail: string | null;
  userName: string | null;
  hooksPath: string | null;
}

interface Index {
  readonly entries: IndexEntry[];
  add(paths: string | string[]): void;
  addAll(): void;
  reset(paths?: string | string[]): void;
  resetAll(): void;
  has(path: string): boolean;
  get(path: string): IndexEntry | null;
  diff(): Diff;
}

interface Diff {
  readonly stats: DiffStats;
  readonly files: DiffFile[];
  toString(): string;
  toNumstat(): string;
  [Symbol.iterator](): Iterator<DiffFile>;
}

interface Blob {
  readonly sha: string;
  readonly size: number;
  readonly isBinary: boolean;
  content(): Buffer;
  text(): string;
  stream(): ReadableStream<Uint8Array>;
}

// Error classes
class GitError extends Error {
  readonly command?: string;
  readonly exitCode?: number;
  readonly stderr?: string;

  constructor(message: string, options?: { command?: string; exitCode?: number; stderr?: string }) {
    super(message);
    this.name = "GitError";
    this.command = options?.command;
    this.exitCode = options?.exitCode;
    this.stderr = options?.stderr;
  }
}

class NotARepositoryError extends GitError {
  constructor(message?: string) {
    super(message || "Not a git repository");
    this.name = "NotARepositoryError";
  }
}

class RefNotFoundError extends GitError {
  readonly ref: string;

  constructor(ref: string) {
    super(`Reference not found: ${ref}`);
    this.name = "RefNotFoundError";
    this.ref = ref;
  }
}

class MergeConflictError extends GitError {
  readonly conflictedFiles: string[];

  constructor(files: string[]) {
    super("Merge conflict");
    this.name = "MergeConflictError";
    this.conflictedFiles = files;
  }
}

class CheckoutConflictError extends GitError {
  readonly conflictedFiles: string[];

  constructor(files: string[]) {
    super("Checkout conflict");
    this.name = "CheckoutConflictError";
    this.conflictedFiles = files;
  }
}

class DetachedHeadError extends GitError {
  constructor() {
    super("Repository is in detached HEAD state");
    this.name = "DetachedHeadError";
  }
}

export {
  BlobImpl as Blob,
  BranchImpl as Branch,
  CheckoutConflictError,
  CommitImpl as Commit,
  ConfigImpl as Config,
  DetachedHeadError,
  DiffImpl as Diff,
  GitError,
  IndexImpl as Index,
  MergeConflictError,
  NotARepositoryError,
  RefNotFoundError,
  RemoteImpl as Remote,
  RepositoryWrapper as Repository,
  StatusEntry,
};

export default {
  Repository: RepositoryWrapper,
  GitError,
  NotARepositoryError,
  RefNotFoundError,
  MergeConflictError,
  CheckoutConflictError,
  DetachedHeadError,
};
