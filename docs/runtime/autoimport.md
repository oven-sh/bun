If no `node_modules` directory is found in the working directory or higher, Bun will abandon Node.js-style module resolution in favor of the **Bun module resolution algorithm**.

Under Bun-style module resolution, all imported packages are auto-installed on the fly into a [global module cache](https://bun.sh/docs/install/cache) during execution (the same cache used by [`bun install`](https://bun.sh/docs/cli/install)).

```ts
import { foo } from "foo"; // install `latest` version

foo();
```

The first time you run this script, Bun will auto-install `"foo"` and cache it. The next time you run the script, it will use the cached version.

## Version resolution

To determine which version to install, Bun follows the following algorithm:

1. Check for a `bun.lock` file in the project root. If it exists, use the version specified in the lockfile.
2. Otherwise, scan up the tree for a `package.json` that includes `"foo"` as a dependency. If found, use the specified semver version or version range.
3. Otherwise, use `latest`.

## Cache behavior

Once a version or version range has been determined, Bun will:

1. Check the module cache for a compatible version. If one exists, use it.
2. When resolving `latest`, Bun will check if `package@latest` has been downloaded and cached in the last _24 hours_. If so, use it.
3. Otherwise, download and install the appropriate version from the `npm` registry.

## Installation

Packages are installed and cached into `<cache>/<pkg>@<version>`, so multiple versions of the same package can be cached at once. Additionally, a symlink is created under `<cache>/<pkg>/<version>` to make it faster to look up all versions of a package that exist in the cache.

## Version specifiers

This entire resolution algorithm can be short-circuited by specifying a version or version range directly in your import statement.

```ts
import { z } from "zod@3.0.0"; // specific version
import { z } from "zod@next"; // npm tag
import { z } from "zod@^3.20.0"; // semver range
```

## Benefits

This auto-installation approach is useful for a few reasons:

- **Space efficiency** — Each version of a dependency only exists in one place on disk. This is a huge space and time savings compared to redundant per-project installations.
- **Portability** — To share simple scripts and gists, your source file is _self-contained_. No need to `zip` together a directory containing your code and config files. With version specifiers in `import` statements, even a `package.json` isn't necessary.
- **Convenience** — There's no need to run `npm install` or `bun install` before running a file or script. Just `bun run` it.
- **Backwards compatibility** — Because Bun still respects the versions specified in `package.json` if one exists, you can switch to Bun-style resolution with a single command: `rm -rf node_modules`.

## Limitations

- No Intellisense. TypeScript auto-completion in IDEs relies on the existence of type declaration files inside `node_modules`. We are investigating various solutions to this.
- No [patch-package](https://github.com/ds300/patch-package) support

<!-- - The implementation details of Bun's install cache will change between versions. Don't think of it as an API. To reliably resolve packages, use Bun's builtin APIs (such as `Bun.resolveSync` or `import.meta.resolve`) instead of relying on the filesystem directly. Bun will likely move to a binary archive format where packages may not correspond to files/folders on disk at all - so if you depend on the filesystem structure instead of the JavaScript API, your code will eventually break. -->

<!-- ## Customizing behavior

To prefer locally-installed versions of packages. Instead of checking npm for latest versions, you can pass the `--prefer-offline` flag to prefer locally-installed versions of packages.

```bash
$ bun run --prefer-offline my-script.ts
```

This will check the install cache for installed versions of packages before checking the npm registry. If no matching version of a package is installed, only then will it check npm for the latest version.

#### Prefer latest

To always use the latest version of a package, you can pass the `--prefer-latest` flag.

```bash
$ bun run --prefer-latest my-script.ts
``` -->

## FAQ

{% details summary="How is this different from what pnpm does?" %}

With pnpm, you have to run `pnpm install`, which creates a `node_modules` folder of symlinks for the runtime to resolve. By contrast, Bun resolves dependencies on the fly when you run a file; there's no need to run any `install` command ahead of time. Bun also doesn't create a `node_modules` folder.

{% /details %}

{% details summary="How is this different from Yarn Plug'N'Play does?" %}
With Yarn, you must run `yarn install` before you run a script. By contrast, Bun resolves dependencies on the fly when you run a file; there's no need to run any `install` command ahead of time.

Yarn Plug'N'Play also uses zip files to store dependencies. This makes dependency loading [slower at runtime](https://twitter.com/jarredsumner/status/1458207919636287490), as random access reads on zip files tend to be slower than the equivalent disk lookup.
{% /details %}

{% details summary="How is this different from what Deno does?" %}

Deno requires an `npm:` specifier before each npm `import`, lacks support for import maps via `compilerOptions.paths` in `tsconfig.json`, and has incomplete support for `package.json` settings. Unlike Deno, Bun does not currently support URL imports.
{% /details %}
