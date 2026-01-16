 bun:git Module API Design (Class-Based)

  Core Classes

  Repository

  class Repository {
    constructor(path?: string)  // Finds git root from path, throws if not a repo

    static find(startPath?: string): Repository | null  // Non-throwing factory
    static init(path: string, options?: { bare?: boolean; initialBranch?: string }):
  Repository
    static clone(url: string, targetPath: string, options?: CloneOptions): Repository

    readonly path: string      // Repo root (worktree root)
    readonly gitDir: string    // .git directory path
    readonly isBare: boolean

    // State
    get head(): Commit
    get branch(): Branch | null  // null if detached HEAD
    get isClean(): boolean
    get isTransient(): boolean  // merge/rebase/cherry-pick in progress

    // References
    getCommit(ref: string): Commit | null
    getBranch(name: string): Branch | null
    getRemote(name?: string): Remote | null  // default: "origin"
    getDefaultBranch(): Branch | null

    // Collections
    get branches(): BranchCollection
    get remotes(): RemoteCollection
    get worktrees(): WorktreeCollection
    get stash(): StashCollection
    get config(): Config

    // Working tree
    status(options?: StatusOptions): StatusEntry[]
    diff(options?: DiffOptions): Diff

    // Index operations
    add(paths: string | string[]): void
    reset(paths?: string | string[]): void  // Unstage

    // Commit
    commit(message: string, options?: CommitOptions): Commit

    // Checkout
    checkout(ref: string | Branch | Commit, options?: CheckoutOptions): void

    // Reset working tree
    resetHard(ref?: string | Commit): void
    clean(options?: CleanOptions): void

    // Abort transient states
    abortMerge(): void
    abortRebase(): void
    abortCherryPick(): void
    abortRevert(): void
  }

  ---
  Commit

  class Commit {
    readonly sha: string           // Full 40-char SHA
    readonly shortSha: string      // First 7 chars
    readonly message: string       // Full message
    readonly summary: string       // First line
    readonly author: Signature
    readonly committer: Signature
    readonly parents: Commit[]
    readonly tree: string          // Tree SHA

    // Navigation
    parent(n?: number): Commit | null  // Default: first parent

    // Diff
    diff(other?: Commit | string): Diff  // Default: diff against parent

    // File access
    getFile(path: string): Blob | null  // git show <sha>:<path>
    listFiles(): string[]  // git diff-tree --name-only

    // Ancestry
    isAncestorOf(other: Commit | string): boolean
    distanceTo(other: Commit | string): number  // rev-list --count
  }

  ---
  Branch

  class Branch {
    readonly name: string          // e.g., "main" or "feature/foo"
    readonly fullName: string      // e.g., "refs/heads/main"
    readonly isRemote: boolean
    readonly isHead: boolean       // Currently checked out

    get commit(): Commit
    get upstream(): Branch | null  // Tracking branch

    // Comparison with upstream
    get ahead(): number
    get behind(): number

    // Operations
    setUpstream(upstream: Branch | string | null): void
    delete(force?: boolean): void
    rename(newName: string): void

    // Static
    static create(repo: Repository, name: string, target?: Commit | string): Branch
  }

  ---
  Remote

  class Remote {
    readonly name: string          // e.g., "origin"
    readonly url: string           // Fetch URL
    readonly pushUrl: string       // Push URL (may differ)

    // Normalized for comparison (handles SSH vs HTTPS)
    readonly normalizedUrl: string
    readonly urlHash: string       // SHA256 hash for privacy-safe logging

    // Branches
    get defaultBranch(): Branch | null  // origin/HEAD target
    getBranch(name: string): Branch | null
    listBranches(): Branch[]

    // Operations
    fetch(options?: FetchOptions): void
    fetchBranch(branch: string): void
  }

  ---
  Worktree

  class Worktree {
    readonly path: string
    readonly gitDir: string
    readonly isMain: boolean       // Is this the main worktree?

    get head(): Commit
    get branch(): Branch | null
    get isClean(): boolean

    // Get a Repository instance for this worktree
    asRepository(): Repository

    // Operations
    remove(force?: boolean): void

    // Static
    static add(
      repo: Repository,
      path: string,
      options?: { branch?: string; detach?: boolean; commit?: string }
    ): Worktree
  }

  class WorktreeCollection {
    list(): Worktree[]
    get(path: string): Worktree | null
    add(path: string, options?: WorktreeAddOptions): Worktree
    prune(): void
    readonly count: number
  }

  ---
  Diff

  class Diff {
    readonly stats: DiffStats
    readonly files: DiffFile[]

    // Raw output
    toString(): string  // Unified diff format
    toNumstat(): string

    // Iteration
    [Symbol.iterator](): Iterator<DiffFile>
  }

  class DiffFile {
    readonly path: string
    readonly oldPath: string | null  // For renames
    readonly status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
    readonly isBinary: boolean
    readonly additions: number
    readonly deletions: number
    readonly hunks: DiffHunk[]

    // Content
    readonly patch: string
  }

  class DiffHunk {
    readonly oldStart: number
    readonly oldLines: number
    readonly newStart: number
    readonly newLines: number
    readonly header: string
    readonly lines: DiffLine[]
  }

  type DiffLine = {
    type: '+' | '-' | ' '
    content: string
    oldLineNo?: number
    newLineNo?: number
  }

  type DiffStats = {
    filesChanged: number
    insertions: number
    deletions: number
  }

  ---
  StatusEntry

  type FileStatus =
    | 'unmodified'    // ' '
    | 'modified'      // 'M'
    | 'added'         // 'A'
    | 'deleted'       // 'D'
    | 'renamed'       // 'R'
    | 'copied'        // 'C'
    | 'untracked'     // '?'
    | 'ignored'       // '!'
    | 'unmerged'      // 'U'

  class StatusEntry {
    readonly path: string
    readonly indexStatus: FileStatus    // Staged status
    readonly workTreeStatus: FileStatus // Unstaged status
    readonly origPath: string | null    // For renames/copies

    get isStaged(): boolean
    get isUnstaged(): boolean
    get isUntracked(): boolean
    get isConflicted(): boolean
  }

  type StatusOptions = {
    includeUntracked?: boolean      // Default: true
    includeIgnored?: boolean        // Default: false
    noOptionalLocks?: boolean       // --no-optional-locks
  }

  ---
  Index (Staging Area)

  class Index {
    readonly entries: IndexEntry[]

    // Stage files
    add(paths: string | string[]): void
    addAll(): void

    // Unstage files
    reset(paths?: string | string[]): void
    resetAll(): void

    // Query
    has(path: string): boolean
    get(path: string): IndexEntry | null

    // Diff
    diff(): Diff  // Staged changes (--cached)
  }

  class IndexEntry {
    readonly path: string
    readonly sha: string
    readonly mode: number
  }

  ---
  Config

  class Config {
    // Get values
    get(key: string): string | null
    getAll(key: string): string[]
    getBool(key: string): boolean | null
    getInt(key: string): number | null

    // Set values
    set(key: string, value: string): void
    unset(key: string): void

    // Common shortcuts
    get userEmail(): string | null
    get userName(): string | null
    get hooksPath(): string | null

    set userEmail(value: string | null)
    set userName(value: string | null)
    set hooksPath(value: string | null)
  }

  ---
  Stash

  class StashEntry {
    readonly index: number
    readonly message: string
    readonly commit: Commit

    apply(options?: { index?: boolean }): void
    pop(options?: { index?: boolean }): void
    drop(): void
  }

  class StashCollection {
    list(): StashEntry[]
    get(index: number): StashEntry | null

    push(message?: string, options?: { includeUntracked?: boolean }): StashEntry
    pop(): boolean
    apply(index?: number): boolean
    drop(index?: number): boolean
    clear(): void

    readonly count: number
    readonly isEmpty: boolean
  }

  ---
  Blob (File Content)

  class Blob {
    readonly sha: string
    readonly size: number
    readonly isBinary: boolean

    // Content access
    content(): Buffer
    text(): string  // Throws if binary

    // Streaming for large files
    stream(): ReadableStream<Uint8Array>
  }

  ---
  Signature

  class Signature {
    readonly name: string
    readonly email: string
    readonly date: Date
    readonly timezone: string

    toString(): string  // "Name <email>"
  }

  ---
  Supporting Types

  type CloneOptions = {
    depth?: number
    branch?: string
    recurseSubmodules?: boolean
    shallowSubmodules?: boolean
    bare?: boolean
  }

  type CommitOptions = {
    amend?: boolean
    allowEmpty?: boolean
    author?: Signature | string
    noVerify?: boolean  // Skip hooks
  }

  type CheckoutOptions = {
    create?: boolean      // -b
    force?: boolean       // -f
    track?: boolean       // --track
  }

  type CleanOptions = {
    directories?: boolean  // -d
    force?: boolean        // -f
    dryRun?: boolean       // -n
  }

  type FetchOptions = {
    prune?: boolean
    tags?: boolean
    depth?: number
  }

  type DiffOptions = {
    cached?: boolean       // Staged changes only
    ref?: string | Commit  // Compare against (default: HEAD)
    paths?: string[]       // Limit to paths
    contextLines?: number  // -U<n>
    nameOnly?: boolean
    nameStatus?: boolean
    stat?: boolean
  }

  ---
  Error Classes

  class GitError extends Error {
    readonly command?: string
    readonly exitCode?: number
    readonly stderr?: string
  }

  class NotARepositoryError extends GitError {}
  class RefNotFoundError extends GitError {
    readonly ref: string
  }
  class MergeConflictError extends GitError {
    readonly conflictedFiles: string[]
  }
  class CheckoutConflictError extends GitError {
    readonly conflictedFiles: string[]
  }
  class DetachedHeadError extends GitError {}

  ---
  Usage Examples

  import { Repository } from 'bun:git'

  // Open repository
  const repo = Repository.find('/path/to/project')
  if (!repo) throw new Error('Not a git repository')

  // Basic info
  console.log(repo.head.sha)
  console.log(repo.branch?.name)  // null if detached
  console.log(repo.isClean)

  // Status
  for (const entry of repo.status()) {
    if (entry.isUntracked) {
      console.log(`New file: ${entry.path}`)
    }
  }

  // Diff
  const diff = repo.diff()
  console.log(`${diff.stats.insertions}+ ${diff.stats.deletions}-`)
  for (const file of diff.files) {
    console.log(`${file.status} ${file.path}`)
  }

  // Commit
  repo.add(['src/file.ts'])
  const commit = repo.commit('Fix bug')
  console.log(commit.sha)

  // Branch operations
  const feature = Branch.create(repo, 'feature/new-thing')
  repo.checkout(feature)

  // Remote operations
  const origin = repo.getRemote('origin')
  origin?.fetch()

  // Worktrees
  const worktree = Worktree.add(repo, '/tmp/worktree', { branch: 'experiment' })
  const wtRepo = worktree.asRepository()
  // ... work in worktree ...
  worktree.remove()

  // File content from history
  const oldFile = repo.head.parent()?.getFile('README.md')
  console.log(oldFile?.text())

  // Config
  repo.config.set('core.hooksPath', '/path/to/hooks')
  console.log(repo.config.userEmail)

  ---
  Sync vs Async Considerations

  Most operations should be synchronous since git operations on local repos are fast:

  // Sync (preferred for most operations)
  const repo = Repository.find(path)
  const status = repo.status()
  const head = repo.head.sha

  // Async only for network operations
  await repo.getRemote('origin')?.fetch()
  await Repository.clone(url, path)

  If Bun wants to keep the API async-friendly, consider:
  // Sync accessors for commonly-used properties
  repo.head      // Sync getter
  repo.headAsync // Async getter (if needed for consistency)

  ---
  Priority Implementation Order

  1. Repository - Core class, find(), basic properties
  2. Commit - sha, message, getFile()
  3. Branch - name, commit, basic operations
  4. Status/Diff - Critical for UI display
  5. Index - add(), reset()
  6. Remote - url, fetch()
  7. Worktree - Full worktree support
  8. Stash - Stash operations
  9. Config - Config get/set