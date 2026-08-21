declare module "bun" {
  /**
   * Security scanner declarations for `bun install`
   */
  export namespace Security {
    export interface Package {
      /**
       * The name of the package
       */
      name: string;

      /**
       * What Bun resolved the requested range to, **not** a range itself.
       *
       * For packages from a registry this is the exact semver version, like
       * `4.1.2`. For packages from other sources this is the resolved
       * specifier as it appears in `bun.lock`, for example
       * `github:user/repo#<commit>`, `git+https://host/repo.git#<commit>`,
       * `https://example.com/pkg.tgz`, `./vendor/pkg.tgz`, `file:packages/pkg`
       * or `link:pkg`. Compare it with {@link Bun.semver.satisfies}, which
       * returns `false` for such specifiers, rather than assuming it parses
       * as semver.
       */
      version: string;

      /**
       * The URL of the package tarball (`.tgz`) Bun downloads, or the path of
       * a local tarball.
       *
       * For `github:` dependencies this is the GitHub API tarball URL for the
       * resolved commit (honoring `GITHUB_API_URL`). Empty for packages that
       * are not installed from a tarball, such as `git+` dependencies and
       * local `file:` / `link:` directories.
       */
      tarball: string;

      /**
       * The range the command requested, as written in `package.json` or on
       * the command line: a tag like `beta`, a semver range like `>=4.0.0`, or
       * a non-registry specifier like `github:user/repo` or `file:./pkg`
       */
      requestedRange: string;
    }

    /**
     * The result of a security scan of a package
     */
    export interface Advisory {
      /**
       * The severity of the advisory.
       *
       * Bun always pretty-prints every advisory returned from the
       * {@link Scanner.scan `scan()`} hook, then:
       *
       * - if any is **fatal**, Bun immediately cancels the installation and
       *   exits with a non-zero exit code
       * - otherwise, if any is **warn**, Bun asks whether to continue with
       *   the install when running in a TTY, and exits immediately when not
       */
      level: "fatal" | "warn";

      /**
       * The name of the package being installed.
       */
      package: string;

      /**
       * A URL linking to a CVE or report where users can learn more about
       * the advisory, or `null` if none is available.
       */
      url: string | null;

      /**
       * A brief description of the advisory, which Bun prints to the user.
       * `null` if none is available.
       */
      description: string | null;
    }

    export interface Scanner {
      /**
       * The scanner API version this scanner implements.
       *
       * Bun uses it to distinguish API versions, since third-party scanner
       * package versions are unrelated to Bun versions. A future revision
       * of the API may drop support for version 1.
       */
      version: "1";

      /**
       * Performs an advisory check when the user runs `bun add <package>
       * [...packages]` or a similar command.
       *
       * If this function throws, Bun immediately stops the install and
       * prints the error to the user.
       *
       * @param info An object whose `packages` array contains every
       * proposed dependency, including transitive dependencies of the
       * packages the user asked for, whether it resolves to a registry
       * version, a git repository, a tarball, or a local directory. Workspace
       * packages are part of the project itself and are not included.
       *
       * @returns A list of advisories
       */
      scan: (info: { packages: Package[] }) => Promise<Advisory[]>;
    }
  }
}
