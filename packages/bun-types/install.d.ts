declare module "bun" {
  /**
   * `bun install` related declarations
   */
  export namespace Install {
    /**
     * `bun install` security related declarations
     */
    export namespace Security {
      export interface Package {
        /**
         * The name of the package
         */
        name: string;

        /**
         * The resolved version to be installed that matches the requested range.
         *
         * This is the exact version string, **not** a range.
         */
        version: string;

        /**
         * The registry url this package is from
         */
        registryUrl: string;

        /**
         * The range that was requested by the command
         */
        requestedRange: string;

        /**
         * Integrity hash provided from the registry
         *
         * Bun will usually verify this, but it's possible there are cases where
         * it was not validated.
         */
        integrity: string;
      }

      /**
       * Advisory represents the result of a security scan result of a package
       */
      export interface Advisory {
        /**
         * Level represents the degree of danger for a security advisory
         *
         * Bun behaves differently depending on the values returned from the
         * {@link Provider.onInstall `onInstall`} hook:
         *
         * > In any case, Bun **always** pretty prints *all* the advisories,
         * > but...
         * >
         * > → if any **fatal**, Bun will immediately cancel the installation
         * > and quit with a non-zero exit code
         * >
         * > → else, if any **warn**, Bun will ask the user if they'd like to
         * > continue with the install
         */
        level: "fatal" | "warn";

        /**
         * The name of the package attempting to be installed.
         */
        package: string;

        /**
         * If available, this is a url linking to a CVE or report online so
         * users can learn more about the advisory.
         */
        url: string | null;

        /**
         * If available, this is a brief description of the advisory that Bun
         * will print to the user.
         */
        description: string | null;
      }

      /**
       * The callback argument for the `onInstall` hook
       */
      export interface OnInstallInfo {
        packages: Package[];
      }

      export type Provider = {
        /**
         * This is the version of the provider implementation. It may change in
         * future versions, so we will use this version to discriminate between
         * such versions. It's entirely possible this API changes in the future
         * so much that version 1 would no longer be supported.
         *
         * The version is required because third-party provider package versions
         * are inherently unrelated to Bun versions
         */
        version: "1";

        /**
         * Perform an advisory check when a user ran `bun add <package>
         * [...packages]`
         *
         * If this function throws an error, Bun will immediately stop the
         * install process and print the error to the user.
         *
         * @param info An object containing an array of packages to be added.
         * The package array will contain all proposed dependencies, including
         * transitive ones. More simply, that means it will include dependencies
         * of the packages the user wants to add.
         *
         * @returns A list of advisories.
         */
        onInstall: (info: OnInstallInfo) => Promise<Advisory[]>;
      };
    }
  }
}
