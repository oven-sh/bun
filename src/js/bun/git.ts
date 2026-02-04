// Hardcoded module "bun:git"

let Git: any;

function initializeGit() {
  Git = $cpp("git/JSGit.cpp", "createJSGitModule");
}

interface Signature {
  name: string;
  email: string;
  time: number; // Unix timestamp in milliseconds
}

interface StatusOptions {
  includeUntracked?: boolean;
  includeIgnored?: boolean;
  recurseUntrackedDirs?: boolean;
  detectRenames?: boolean;
}

interface InternalStatusEntry {
  path: string;
  status: number;
}

interface IndexEntry {
  path: string;
  mode: number;
  oid: string;
  stage: number;
  size: number;
}

interface DiffOptions {
  cached?: boolean;
}

interface DiffFile {
  status: number;
  oldPath: string | null;
  newPath: string;
  similarity?: number;
}

interface DiffResult {
  files: DiffFile[];
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

interface LogOptions {
  from?: string;
  range?: string;
  limit?: number;
}

// Status constants (nodegit compatible)
const Status = {
  CURRENT: 0,
  INDEX_NEW: 1,
  INDEX_MODIFIED: 2,
  INDEX_DELETED: 4,
  INDEX_RENAMED: 8,
  INDEX_TYPECHANGE: 16,
  WT_NEW: 128,
  WT_MODIFIED: 256,
  WT_DELETED: 512,
  WT_TYPECHANGE: 1024,
  WT_RENAMED: 2048,
  IGNORED: 16384,
  CONFLICTED: 32768,
};

// DeltaType constants (nodegit compatible)
const DeltaType = {
  UNMODIFIED: 0,
  ADDED: 1,
  DELETED: 2,
  MODIFIED: 3,
  RENAMED: 4,
  COPIED: 5,
  IGNORED: 6,
  UNTRACKED: 7,
  TYPECHANGE: 8,
  CONFLICTED: 10,
};

class StatusEntry {
  path: string;
  status: number;

  constructor(entry: InternalStatusEntry) {
    this.path = entry.path;
    this.status = entry.status;
  }

  isNew(): boolean {
    return (this.status & (Status.INDEX_NEW | Status.WT_NEW)) !== 0;
  }

  isModified(): boolean {
    return (this.status & (Status.INDEX_MODIFIED | Status.WT_MODIFIED)) !== 0;
  }

  isDeleted(): boolean {
    return (this.status & (Status.INDEX_DELETED | Status.WT_DELETED)) !== 0;
  }

  isRenamed(): boolean {
    return (this.status & (Status.INDEX_RENAMED | Status.WT_RENAMED)) !== 0;
  }

  isIgnored(): boolean {
    return (this.status & Status.IGNORED) !== 0;
  }

  inIndex(): boolean {
    return (
      (this.status &
        (Status.INDEX_NEW |
          Status.INDEX_MODIFIED |
          Status.INDEX_DELETED |
          Status.INDEX_RENAMED |
          Status.INDEX_TYPECHANGE)) !==
      0
    );
  }

  inWorkingTree(): boolean {
    return (
      (this.status &
        (Status.WT_NEW | Status.WT_MODIFIED | Status.WT_DELETED | Status.WT_TYPECHANGE | Status.WT_RENAMED)) !==
      0
    );
  }
}

class Repository {
  #repo: any;

  constructor(repo: any) {
    this.#repo = repo;
  }

  /**
   * Open an existing Git repository
   */
  static open(path: string): Repository {
    if (!Git) {
      initializeGit();
    }
    const repo = Git.Repository.open(path);
    return new Repository(repo);
  }

  /**
   * Get the HEAD commit
   */
  head(): Commit {
    const commit = this.#repo.head();
    return new Commit(commit);
  }

  /**
   * Get the .git directory path
   */
  get path(): string {
    return this.#repo.path;
  }

  /**
   * Get the working directory path (null for bare repositories)
   */
  get workdir(): string | null {
    return this.#repo.workdir;
  }

  /**
   * Check if this is a bare repository
   */
  get isBare(): boolean {
    return this.#repo.isBare;
  }

  /**
   * Get the working directory status (nodegit compatible)
   */
  getStatus(options?: StatusOptions): StatusEntry[] {
    const entries = this.#repo.getStatus(options);
    return entries.map((e: InternalStatusEntry) => new StatusEntry(e));
  }

  /**
   * Resolve a revision spec to an OID
   */
  revParse(spec: string): string {
    return this.#repo.revParse(spec);
  }

  /**
   * Get the name of the current branch (null if detached HEAD or no commits)
   */
  getCurrentBranch(): string | null {
    return this.#repo.getCurrentBranch();
  }

  /**
   * Get ahead/behind counts between two commits
   */
  aheadBehind(local?: string, upstream?: string): { ahead: number; behind: number } {
    return this.#repo.aheadBehind(local, upstream);
  }

  /**
   * Get list of files in the index
   */
  listFiles(): IndexEntry[] {
    return this.#repo.listFiles();
  }

  /**
   * Get diff information
   */
  diff(options?: DiffOptions): DiffResult {
    return this.#repo.diff(options);
  }

  /**
   * Count commits in a range
   */
  countCommits(range?: string): number {
    return this.#repo.countCommits(range);
  }

  /**
   * Get commit history
   */
  log(options?: LogOptions): Commit[] {
    const commits = this.#repo.log(options);
    return commits.map((c: any) => new Commit(c));
  }
}

class Commit {
  #commit: any;

  constructor(commit: any) {
    this.#commit = commit;
  }

  /**
   * Get the commit OID (SHA-1 hash)
   */
  get id(): string {
    return this.#commit.id;
  }

  /**
   * Get the full commit message
   */
  get message(): string {
    return this.#commit.message;
  }

  /**
   * Get the first line of the commit message
   */
  get summary(): string {
    return this.#commit.summary;
  }

  /**
   * Get the author signature
   */
  get author(): Signature {
    return this.#commit.author;
  }

  /**
   * Get the committer signature
   */
  get committer(): Signature {
    return this.#commit.committer;
  }

  /**
   * Get the commit time as Unix timestamp (seconds since epoch)
   */
  get time(): number {
    return this.#commit.time;
  }
}

export default {
  __esModule: true,
  Repository,
  Commit,
  StatusEntry,
  Status,
  DeltaType,
  default: Repository,
};
