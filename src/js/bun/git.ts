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

interface StatusEntry {
  path: string;
  status: string;
}

interface LogOptions {
  from?: string;
  limit?: number;
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
  default: Repository,
};
