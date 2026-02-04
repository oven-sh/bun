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
  }

  export default Repository;
}
