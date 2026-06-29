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
       * The exact version Bun resolved from the requested range, **not** a
       * range itself.
       */
      version: string;

      /**
       * The URL of the package tarball (`.tgz`) Bun downloads
       */
      tarball: string;

      /**
       * The range the command requested: a tag like `beta` or a semver
       * range like `>=4.0.0`
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
       * packages the user asked for
       *
       * @returns A list of advisories
       */
      scan: (info: { packages: Package[] }) => Promise<Advisory[]>;
    }
  }
}
