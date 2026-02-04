/**
 * Fast Git operations for Bun.js powered by libgit2.
 *
 * This module provides read-only Git repository operations.
 * Network operations (HTTPS/SSH) are not supported - local operations only.
 *
 * @example
 * ```ts
 * import { Repository } from 'bun:git';
 *
 * const repo = Repository.open('.');
 * const head = repo.head();
 * console.log(`HEAD: ${head.id} - ${head.summary}`);
 * console.log(`Author: ${head.author.name} <${head.author.email}>`);
 * ```
 *
 * @module bun:git
 */
declare module "bun:git" {
  /**
   * Represents a Git signature (author or committer information).
   */
  export interface Signature {
    /**
     * The name of the person.
     * @example "John Doe"
     */
    readonly name: string;

    /**
     * The email address of the person.
     * @example "john@example.com"
     */
    readonly email: string;

    /**
     * Unix timestamp of when the signature was created.
     * @example 1704067200
     */
    readonly time: number;
  }

  /**
   * Status flags for working directory entries.
   * These are bit flags that can be combined with bitwise OR.
   *
   * @example
   * ```ts
   * import { Status } from 'bun:git';
   *
   * const entries = repo.getStatus();
   * for (const entry of entries) {
   *   if (entry.status & Status.WT_MODIFIED) {
   *     console.log('Modified in workdir:', entry.path);
   *   }
   *   if (entry.status & Status.INDEX_NEW) {
   *     console.log('New in index:', entry.path);
   *   }
   * }
   * ```
   */
  export const Status: {
    /** Entry is current and unchanged */
    readonly CURRENT: 0;
    /** Entry is new in the index */
    readonly INDEX_NEW: 1;
    /** Entry is modified in the index */
    readonly INDEX_MODIFIED: 2;
    /** Entry is deleted in the index */
    readonly INDEX_DELETED: 4;
    /** Entry is renamed in the index */
    readonly INDEX_RENAMED: 8;
    /** Entry type changed in the index */
    readonly INDEX_TYPECHANGE: 16;
    /** Entry is new in the working tree */
    readonly WT_NEW: 128;
    /** Entry is modified in the working tree */
    readonly WT_MODIFIED: 256;
    /** Entry is deleted in the working tree */
    readonly WT_DELETED: 512;
    /** Entry type changed in the working tree */
    readonly WT_TYPECHANGE: 1024;
    /** Entry is renamed in the working tree */
    readonly WT_RENAMED: 2048;
    /** Entry is ignored */
    readonly IGNORED: 16384;
    /** Entry is conflicted */
    readonly CONFLICTED: 32768;
  };

  /**
   * Delta types for diff entries.
   *
   * @example
   * ```ts
   * import { DeltaType } from 'bun:git';
   *
   * const diff = repo.diff();
   * for (const file of diff.files) {
   *   if (file.status === DeltaType.ADDED) {
   *     console.log('Added:', file.newPath);
   *   }
   * }
   * ```
   */
  export const DeltaType: {
    /** No changes */
    readonly UNMODIFIED: 0;
    /** Entry does not exist in old version */
    readonly ADDED: 1;
    /** Entry does not exist in new version */
    readonly DELETED: 2;
    /** Entry content changed between old and new */
    readonly MODIFIED: 3;
    /** Entry was renamed between old and new */
    readonly RENAMED: 4;
    /** Entry was copied from another old entry */
    readonly COPIED: 5;
    /** Entry is ignored item in workdir */
    readonly IGNORED: 6;
    /** Entry is untracked item in workdir */
    readonly UNTRACKED: 7;
    /** Entry type changed between old and new */
    readonly TYPECHANGE: 8;
    /** Entry is unreadable */
    readonly CONFLICTED: 10;
  };

  /**
   * Options for getting repository status.
   */
  export interface StatusOptions {
    /**
     * Include untracked files in the status.
     * @default true
     */
    includeUntracked?: boolean;

    /**
     * Include ignored files in the status.
     * @default false
     */
    includeIgnored?: boolean;

    /**
     * Recurse into untracked directories.
     * @default true
     */
    recurseUntrackedDirs?: boolean;

    /**
     * Detect renamed files.
     * @default false
     */
    detectRenames?: boolean;
  }

  /**
   * Represents a status entry for a file in the working directory.
   */
  export class StatusEntry {
    /**
     * The path of the file relative to the repository root.
     */
    readonly path: string;

    /**
     * Status flags (combination of Status values).
     */
    readonly status: number;

    /**
     * Check if the entry is new (untracked or staged as new).
     */
    isNew(): boolean;

    /**
     * Check if the entry is modified.
     */
    isModified(): boolean;

    /**
     * Check if the entry is deleted.
     */
    isDeleted(): boolean;

    /**
     * Check if the entry is renamed.
     */
    isRenamed(): boolean;

    /**
     * Check if the entry is ignored.
     */
    isIgnored(): boolean;

    /**
     * Check if the entry has changes staged in the index.
     */
    inIndex(): boolean;

    /**
     * Check if the entry has changes in the working tree.
     */
    inWorkingTree(): boolean;
  }

  /**
   * Represents an entry in the Git index.
   */
  export interface IndexEntry {
    /**
     * The path of the file relative to the repository root.
     */
    readonly path: string;

    /**
     * The file mode (e.g., 0o100644 for regular files).
     */
    readonly mode: number;

    /**
     * The blob OID (SHA-1 hash) of the file content.
     */
    readonly oid: string;

    /**
     * The stage number (0 for normal, 1-3 for conflict stages).
     */
    readonly stage: number;

    /**
     * The file size in bytes.
     */
    readonly size: number;
  }

  /**
   * Options for getting diff information.
   */
  export interface DiffOptions {
    /**
     * If true, compare HEAD to index (staged changes).
     * If false, compare HEAD to working directory.
     * @default false
     */
    cached?: boolean;
  }

  /**
   * Represents a changed file in a diff.
   */
  export interface DiffFile {
    /**
     * The type of change (see DeltaType).
     */
    readonly status: number;

    /**
     * The old path (null for added files).
     */
    readonly oldPath: string | null;

    /**
     * The new path.
     */
    readonly newPath: string;

    /**
     * Similarity percentage for renamed/copied files (0-100).
     */
    readonly similarity?: number;
  }

  /**
   * Result of a diff operation.
   */
  export interface DiffResult {
    /**
     * List of changed files.
     */
    readonly files: DiffFile[];

    /**
     * Statistics about the diff.
     */
    readonly stats: {
      /** Number of files changed */
      readonly filesChanged: number;
      /** Total lines inserted */
      readonly insertions: number;
      /** Total lines deleted */
      readonly deletions: number;
    };
  }

  /**
   * Options for getting commit history.
   */
  export interface LogOptions {
    /**
     * Starting point for history traversal.
     * @default "HEAD"
     */
    from?: string;

    /**
     * Range specification (e.g., "origin/main..HEAD").
     * If provided, `from` is ignored.
     */
    range?: string;

    /**
     * Maximum number of commits to return.
     * @default unlimited
     */
    limit?: number;
  }

  /**
   * Represents a Git commit object.
   *
   * A commit contains information about a snapshot of the repository,
   * including the author, committer, message, and parent commits.
   *
   * @example
   * ```ts
   * const head = repo.head();
   * console.log(head.id);       // "abc123..."
   * console.log(head.message);  // "feat: add new feature\n\nDetailed description..."
   * console.log(head.summary);  // "feat: add new feature"
   * ```
   */
  export class Commit {
    /**
     * The full 40-character hexadecimal SHA-1 hash of the commit.
     * @example "a1b2c3d4e5f6..."
     */
    readonly id: string;

    /**
     * The full commit message, including the body.
     * @example "feat: add new feature\n\nThis commit adds..."
     */
    readonly message: string;

    /**
     * The first line of the commit message (the summary/title).
     * Does not include any trailing newline.
     * @example "feat: add new feature"
     */
    readonly summary: string;

    /**
     * The author of the commit (who wrote the changes).
     */
    readonly author: Signature;

    /**
     * The committer of the commit (who committed the changes).
     * This may differ from the author in cases like cherry-picks or rebases.
     */
    readonly committer: Signature;

    /**
     * Unix timestamp of when the commit was created.
     * This is the committer's timestamp.
     * @example 1704067200
     */
    readonly time: number;
  }

  /**
   * Represents a Git repository.
   *
   * Use {@link Repository.open} to open an existing repository.
   *
   * @example
   * ```ts
   * import { Repository } from 'bun:git';
   *
   * // Open the repository at the current directory
   * const repo = Repository.open('.');
   *
   * // Get repository info
   * console.log('Path:', repo.path);        // "/path/to/repo/.git/"
   * console.log('Workdir:', repo.workdir);  // "/path/to/repo/"
   * console.log('Is bare:', repo.isBare);   // false
   *
   * // Get the HEAD commit
   * const head = repo.head();
   * console.log('HEAD:', head.id.slice(0, 7), head.summary);
   * ```
   */
  export class Repository {
    /**
     * Opens an existing Git repository.
     *
     * The path can point to either a working directory or a bare repository.
     * If the path points to a working directory, the `.git` directory will be located automatically.
     *
     * @param path Path to the repository (working directory or .git directory)
     * @returns A Repository instance
     * @throws Error if the path is not a valid Git repository
     *
     * @example
     * ```ts
     * // Open by working directory
     * const repo = Repository.open('/path/to/project');
     *
     * // Open by .git directory
     * const repo2 = Repository.open('/path/to/project/.git');
     *
     * // Open current directory
     * const repo3 = Repository.open('.');
     * ```
     */
    static open(path: string): Repository;

    /**
     * Gets the commit that HEAD currently points to.
     *
     * @returns The commit that HEAD references
     * @throws Error if HEAD is unborn (new repository with no commits)
     *
     * @example
     * ```ts
     * const head = repo.head();
     * console.log(`Current commit: ${head.summary}`);
     * console.log(`Author: ${head.author.name}`);
     * ```
     */
    head(): Commit;

    /**
     * The path to the `.git` directory.
     * Always ends with a trailing slash.
     *
     * @example "/Users/me/project/.git/"
     */
    readonly path: string;

    /**
     * The path to the working directory.
     * Returns `null` for bare repositories.
     * When present, always ends with a trailing slash.
     *
     * @example "/Users/me/project/"
     */
    readonly workdir: string | null;

    /**
     * Whether this is a bare repository.
     * Bare repositories have no working directory.
     *
     * @example
     * ```ts
     * if (repo.isBare) {
     *   console.log('This is a bare repository');
     * }
     * ```
     */
    readonly isBare: boolean;

    /**
     * Gets the working directory status.
     *
     * Returns an array of status entries for all changed files in the
     * working directory and index.
     *
     * @param options Options to control which files are included
     * @returns Array of status entries
     *
     * @example
     * ```ts
     * import { Repository, Status } from 'bun:git';
     *
     * const repo = Repository.open('.');
     * const status = repo.getStatus();
     *
     * for (const entry of status) {
     *   if (entry.isModified()) {
     *     console.log('Modified:', entry.path);
     *   }
     *   if (entry.isNew()) {
     *     console.log('New:', entry.path);
     *   }
     * }
     * ```
     */
    getStatus(options?: StatusOptions): StatusEntry[];

    /**
     * Resolves a revision specification to a commit OID.
     *
     * Supports standard Git revision syntax including:
     * - Branch names: "main", "feature/foo"
     * - Tag names: "v1.0.0"
     * - SHA prefixes: "abc123"
     * - Special refs: "HEAD", "HEAD~1", "HEAD^2"
     * - Upstream: "@{u}", "main@{u}"
     *
     * @param spec The revision specification to resolve
     * @returns The 40-character hex OID
     * @throws Error if the spec cannot be resolved
     *
     * @example
     * ```ts
     * const headOid = repo.revParse('HEAD');
     * const parentOid = repo.revParse('HEAD~1');
     * const branchOid = repo.revParse('main');
     * ```
     */
    revParse(spec: string): string;

    /**
     * Gets the name of the current branch.
     *
     * @returns The branch name, or null if HEAD is detached or unborn
     *
     * @example
     * ```ts
     * const branch = repo.getCurrentBranch();
     * if (branch) {
     *   console.log('On branch:', branch);
     * } else {
     *   console.log('HEAD is detached');
     * }
     * ```
     */
    getCurrentBranch(): string | null;

    /**
     * Gets the ahead/behind counts between two commits.
     *
     * This is useful for comparing a local branch to its upstream.
     *
     * @param local The local ref (default: "HEAD")
     * @param upstream The upstream ref (default: "@{u}")
     * @returns Object with ahead and behind counts
     *
     * @example
     * ```ts
     * const { ahead, behind } = repo.aheadBehind();
     * console.log(`${ahead} ahead, ${behind} behind`);
     *
     * // Compare specific refs
     * const { ahead, behind } = repo.aheadBehind('feature', 'origin/main');
     * ```
     */
    aheadBehind(local?: string, upstream?: string): { ahead: number; behind: number };

    /**
     * Gets the list of files tracked in the index.
     *
     * @returns Array of index entries
     *
     * @example
     * ```ts
     * const files = repo.listFiles();
     * console.log(`Tracking ${files.length} files`);
     *
     * for (const file of files) {
     *   console.log(`${file.path} (mode: ${file.mode.toString(8)})`);
     * }
     * ```
     */
    listFiles(): IndexEntry[];

    /**
     * Gets diff information between HEAD and working directory or index.
     *
     * @param options Options to control the diff behavior
     * @returns Diff result with file list and statistics
     *
     * @example
     * ```ts
     * import { Repository, DeltaType } from 'bun:git';
     *
     * const repo = Repository.open('.');
     *
     * // Unstaged changes (HEAD vs workdir)
     * const diff = repo.diff();
     * console.log(`${diff.stats.filesChanged} files changed`);
     * console.log(`+${diff.stats.insertions} -${diff.stats.deletions}`);
     *
     * // Staged changes (HEAD vs index)
     * const staged = repo.diff({ cached: true });
     *
     * for (const file of diff.files) {
     *   if (file.status === DeltaType.MODIFIED) {
     *     console.log('Modified:', file.newPath);
     *   }
     * }
     * ```
     */
    diff(options?: DiffOptions): DiffResult;

    /**
     * Counts the number of commits in a range.
     *
     * @param range Optional range specification (e.g., "origin/main..HEAD")
     * @returns Number of commits
     *
     * @example
     * ```ts
     * // Total commits
     * const total = repo.countCommits();
     *
     * // Commits since origin/main
     * const since = repo.countCommits('origin/main..HEAD');
     * ```
     */
    countCommits(range?: string): number;

    /**
     * Gets the commit history.
     *
     * @param options Options to control the log behavior
     * @returns Array of commits
     *
     * @example
     * ```ts
     * // Last 10 commits
     * const commits = repo.log({ limit: 10 });
     *
     * for (const commit of commits) {
     *   console.log(`${commit.id.slice(0, 7)} ${commit.summary}`);
     * }
     *
     * // Commits in a range
     * const range = repo.log({ range: 'origin/main..HEAD' });
     *
     * // Commits from a specific ref
     * const fromTag = repo.log({ from: 'v1.0.0', limit: 5 });
     * ```
     */
    log(options?: LogOptions): Commit[];
  }

  export default Repository;
}
