Packages on `npm` can define _lifecycle scripts_ in their `package.json`. Some of the most common are below, but there are [many others](https://docs.npmjs.com/cli/v10/using-npm/scripts).

- `preinstall`: Runs before the package is installed
- `postinstall`: Runs after the package is installed
- `preuninstall`: Runs before the package is uninstalled
- `prepublishOnly`: Runs before the package is published

These scripts are arbitrary shell commands that the package manager is expected to read and execute at the appropriate time. But executing arbitrary scripts represents a potential security risk, so—unlike other `npm` clients—Bun does not execute arbitrary lifecycle scripts by default.

## `postinstall`

The `postinstall` script is particularly important. It's widely used to build or install platform-specific binaries for packages that are implemented as [native Node.js add-ons](https://nodejs.org/api/addons.html). For example, `node-sass` is a popular package that uses `postinstall` to build a native binary for Sass.

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "node-sass": "^6.0.1"
  }
}
```

## `trustedDependencies`

Instead of executing arbitrary scripts, Bun uses a "default-secure" approach. You can add certain packages to an allow list, and Bun will execute lifecycle scripts for those packages. To tell Bun to allow lifecycle scripts for a particular package, add the package name to `trustedDependencies` array in your `package.json`.

```json-diff
  {
    "name": "my-app",
    "version": "1.0.0",
+   "trustedDependencies": ["node-sass"]
  }
```

Once added to `trustedDependencies`, install/re-install the package. Bun will read this field and run lifecycle scripts for `my-trusted-package`.

As of Bun v1.0.16, the top 500 npm packages with lifecycle scripts are allowed by default. You can see the full list [here](https://github.com/oven-sh/bun/blob/main/src/install/default-trusted-dependencies.txt).

## `--ignore-scripts`

To disable lifecycle scripts for all packages, use the `--ignore-scripts` flag.

```bash
$ bun install --ignore-scripts
```
